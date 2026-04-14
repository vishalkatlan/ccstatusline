import { execFileSync } from 'child_process';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync
} from 'fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export interface PrData {
    number: number;
    url: string;
    title: string;
    state: string;
    reviewDecision: string;
}

export interface PrDataExtended extends PrData {
    baseRefName: string;
    mergeable: string;
}

interface PrListCacheFile {
    fingerprint: string;
    data: PrDataExtended[] | null;
}

const PR_CACHE_TTL = 30_000;
const PR_FINGERPRINT_TTL = 300_000; // 5 minutes when fingerprint matches
const GH_TIMEOUT = 5_000;
const DEFAULT_TITLE_MAX_WIDTH = 30;

export interface PrCacheDeps {
    execFileSync: typeof execFileSync;
    existsSync: typeof existsSync;
    mkdirSync: typeof mkdirSync;
    readFileSync: typeof readFileSync;
    statSync: typeof statSync;
    writeFileSync: typeof writeFileSync;
    getHomedir: typeof os.homedir;
    now: typeof Date.now;
}

const DEFAULT_PR_CACHE_DEPS: PrCacheDeps = {
    execFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync,
    getHomedir: os.homedir,
    now: Date.now
};

function getCacheDir(deps: PrCacheDeps): string {
    return path.join(deps.getHomedir(), '.cache', 'ccstatusline');
}

function getPrCacheDir(deps: PrCacheDeps): string {
    return path.join(getCacheDir(deps), 'pr');
}

function runGitForCache(args: string[], cwd: string, deps: PrCacheDeps): string {
    try {
        return deps.execFileSync('git', args, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            cwd,
            timeout: GH_TIMEOUT
        }).trim();
    } catch {
        return '';
    }
}

function getCacheRef(cwd: string, deps: PrCacheDeps): string {
    const branch = runGitForCache(['branch', '--show-current'], cwd, deps);
    if (branch.length > 0) {
        return `branch:${branch}`;
    }

    const head = runGitForCache(['rev-parse', '--short', 'HEAD'], cwd, deps);
    if (head.length > 0) {
        return `head:${head}`;
    }

    return 'unknown';
}

function getCachePath(cwd: string, ref: string, deps: PrCacheDeps): string {
    const hash = createHash('sha256')
        .update(cwd)
        .update('\0')
        .update(ref)
        .digest('hex')
        .slice(0, 16);
    return path.join(getPrCacheDir(deps), `pr-${hash}.json`);
}

function readCache(cachePath: string, deps: PrCacheDeps): PrData | null | 'miss' {
    try {
        if (!deps.existsSync(cachePath)) {
            return 'miss';
        }
        const age = deps.now() - deps.statSync(cachePath).mtimeMs;
        if (age > PR_CACHE_TTL) {
            return 'miss';
        }
        const content = deps.readFileSync(cachePath, 'utf-8').trim();
        if (content.length === 0) {
            return null;
        }
        const data = JSON.parse(content) as PrData;
        if (typeof data.number !== 'number' || typeof data.url !== 'string') {
            return 'miss';
        }
        return data;
    } catch {
        return 'miss';
    }
}

function writeCache(cachePath: string, data: PrData | null, deps: PrCacheDeps): void {
    try {
        const cacheDir = getPrCacheDir(deps);
        if (!deps.existsSync(cacheDir)) {
            deps.mkdirSync(cacheDir, { recursive: true });
        }
        deps.writeFileSync(cachePath, data ? JSON.stringify(data) : '', 'utf-8');
    } catch {
        // Best-effort caching
    }
}

export function fetchPrData(cwd: string, deps: PrCacheDeps = DEFAULT_PR_CACHE_DEPS): PrData | null {
    const cachePath = getCachePath(cwd, getCacheRef(cwd, deps), deps);
    const cached = readCache(cachePath, deps);
    if (cached !== 'miss') {
        return cached;
    }

    try {
        deps.execFileSync('gh', ['--version'], {
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: GH_TIMEOUT
        });
    } catch {
        writeCache(cachePath, null, deps);
        return null;
    }

    try {
        const output = deps.execFileSync(
            'gh',
            ['pr', 'view', '--json', 'url,number,title,state,reviewDecision'],
            {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
                cwd,
                timeout: GH_TIMEOUT
            }
        ).trim();

        if (output.length === 0) {
            writeCache(cachePath, null, deps);
            return null;
        }

        const parsed = JSON.parse(output) as Record<string, unknown>;
        if (typeof parsed.number !== 'number' || typeof parsed.url !== 'string') {
            writeCache(cachePath, null, deps);
            return null;
        }
        const data: PrData = {
            number: parsed.number,
            url: parsed.url,
            title: typeof parsed.title === 'string' ? parsed.title : '',
            state: typeof parsed.state === 'string' ? parsed.state : '',
            reviewDecision: typeof parsed.reviewDecision === 'string' ? parsed.reviewDecision : ''
        };

        writeCache(cachePath, data, deps);
        return data;
    } catch {
        writeCache(cachePath, null, deps);
        return null;
    }
}

function getGitFingerprint(cwd: string, deps: PrCacheDeps): string {
    const branch = runGitForCache(['branch', '--show-current'], cwd, deps);
    const headSha = runGitForCache(['rev-parse', 'HEAD'], cwd, deps);
    const remoteSha = runGitForCache(['rev-parse', `origin/${branch}`], cwd, deps);
    return `${branch}|${headSha}|${remoteSha}`;
}

function getPrListCachePath(cwd: string, ref: string, deps: PrCacheDeps): string {
    const hash = createHash('sha256')
        .update(cwd)
        .update('\0')
        .update('list:')
        .update(ref)
        .digest('hex')
        .slice(0, 16);
    return path.join(getPrCacheDir(deps), `pr-list-${hash}.json`);
}

function readPrListCache(cachePath: string, fingerprint: string, deps: PrCacheDeps): PrDataExtended[] | null | 'miss' {
    try {
        if (!deps.existsSync(cachePath)) {
            return 'miss';
        }
        const age = deps.now() - deps.statSync(cachePath).mtimeMs;
        const content = deps.readFileSync(cachePath, 'utf-8').trim();
        if (content.length === 0) {
            // Negative cache — check TTL (use short TTL for negative entries)
            return age > PR_CACHE_TTL ? 'miss' : null;
        }
        const cached = JSON.parse(content) as PrListCacheFile;
        if (cached.fingerprint === fingerprint && age <= PR_FINGERPRINT_TTL) {
            return cached.data;
        }
        if (cached.fingerprint !== fingerprint) {
            return 'miss';
        }
        // Fingerprint matches but TTL expired
        return 'miss';
    } catch {
        return 'miss';
    }
}

function writePrListCache(cachePath: string, fingerprint: string, data: PrDataExtended[] | null, deps: PrCacheDeps): void {
    try {
        const cacheDir = getPrCacheDir(deps);
        if (!deps.existsSync(cacheDir)) {
            deps.mkdirSync(cacheDir, { recursive: true });
        }
        if (data === null) {
            // Negative cache: write empty string for compat with readPrListCache
            deps.writeFileSync(cachePath, '', 'utf-8');
        } else {
            const entry: PrListCacheFile = { fingerprint, data };
            deps.writeFileSync(cachePath, JSON.stringify(entry), 'utf-8');
        }
    } catch {
        // Best-effort caching
    }
}

function parsePrListItem(item: Record<string, unknown>): PrDataExtended | null {
    if (typeof item.number !== 'number' || typeof item.url !== 'string') {
        return null;
    }
    return {
        number: item.number,
        url: item.url,
        title: typeof item.title === 'string' ? item.title : '',
        state: typeof item.state === 'string' ? item.state : '',
        reviewDecision: typeof item.reviewDecision === 'string' ? item.reviewDecision : '',
        baseRefName: typeof item.baseRefName === 'string' ? item.baseRefName : '',
        mergeable: typeof item.mergeable === 'string' ? item.mergeable : ''
    };
}

export function fetchPrListData(cwd: string, deps: PrCacheDeps = DEFAULT_PR_CACHE_DEPS): PrDataExtended[] | null {
    const ref = getCacheRef(cwd, deps);
    const fingerprint = getGitFingerprint(cwd, deps);
    const cachePath = getPrListCachePath(cwd, ref, deps);
    const cached = readPrListCache(cachePath, fingerprint, deps);
    if (cached !== 'miss') {
        return cached;
    }

    try {
        deps.execFileSync('gh', ['--version'], {
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: GH_TIMEOUT
        });
    } catch {
        writePrListCache(cachePath, fingerprint, null, deps);
        return null;
    }

    const branch = runGitForCache(['branch', '--show-current'], cwd, deps);
    if (branch.length === 0) {
        writePrListCache(cachePath, fingerprint, null, deps);
        return null;
    }

    try {
        const output = deps.execFileSync(
            'gh',
            ['pr', 'list', '--head', branch, '--limit', '10',
                '--json', 'url,number,title,state,reviewDecision,baseRefName,mergeable'],
            {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
                cwd,
                timeout: GH_TIMEOUT
            }
        ).trim();

        if (output.length === 0) {
            writePrListCache(cachePath, fingerprint, null, deps);
            return null;
        }

        const parsed = JSON.parse(output) as Record<string, unknown>[];
        if (!Array.isArray(parsed) || parsed.length === 0) {
            writePrListCache(cachePath, fingerprint, null, deps);
            return null;
        }

        const results: PrDataExtended[] = [];
        for (const item of parsed) {
            const pr = parsePrListItem(item);
            if (pr) {
                results.push(pr);
            }
        }

        if (results.length === 0) {
            writePrListCache(cachePath, fingerprint, null, deps);
            return null;
        }

        writePrListCache(cachePath, fingerprint, results, deps);
        return results;
    } catch {
        writePrListCache(cachePath, fingerprint, null, deps);
        return null;
    }
}

export function getPrStatusLabel(state: string, reviewDecision: string): string {
    if (state === 'MERGED')
        return 'MERGED';
    if (state === 'CLOSED')
        return 'CLOSED';
    if (reviewDecision === 'APPROVED')
        return 'APPROVED';
    if (reviewDecision === 'CHANGES_REQUESTED')
        return 'CHANGES_REQ';
    if (state === 'OPEN')
        return 'OPEN';
    return state;
}

export function getExtendedPrStatusLabel(state: string, reviewDecision: string, mergeable: string): string {
    if (state === 'MERGED')
        return 'MERGED';
    if (state === 'CLOSED')
        return 'CLOSED';
    if (mergeable === 'CONFLICTING')
        return 'CONFLICT';
    if (reviewDecision === 'APPROVED')
        return 'APPROVED';
    if (reviewDecision === 'CHANGES_REQUESTED')
        return 'CHANGES_REQ';
    if (reviewDecision === 'REVIEW_REQUIRED')
        return 'REVIEW';
    if (state === 'OPEN')
        return 'OPEN';
    return state;
}

export function shortenBranch(name: string): string {
    if (name.length <= 4) {
        return name;
    }
    if (/[-/]/.test(name)) {
        return name.split(/[-/]/).map(part => part.charAt(0)).join('');
    }
    return name.slice(0, 4);
}

export function truncateTitle(title: string, maxWidth?: number): string {
    const limit = maxWidth ?? DEFAULT_TITLE_MAX_WIDTH;
    if (title.length <= limit)
        return title;
    return `${title.slice(0, limit - 1)}\u2026`;
}