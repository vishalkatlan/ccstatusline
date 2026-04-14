import {
    describe,
    expect,
    it
} from 'vitest';

import {
    fetchPrData,
    fetchPrListData,
    getExtendedPrStatusLabel,
    shortenBranch,
    type PrCacheDeps
} from '../gh-pr-cache';

interface FakeCacheFile {
    content: string;
    mtimeMs: number;
}

interface PrCacheHarness {
    cacheFiles: Map<string, FakeCacheFile>;
    deps: PrCacheDeps;
    execCalls: { args: string[]; cmd: string; cwd?: string }[];
    ghResponses: (Error | string)[];
    setCurrentRef: (ref: string) => void;
}

function createHarness(): PrCacheHarness {
    const cacheFiles = new Map<string, FakeCacheFile>();
    const execCalls: { args: string[]; cmd: string; cwd?: string }[] = [];
    const ghResponses: (Error | string)[] = [];
    const now = 1_700_000_000_000;
    let currentRef = 'feature/cache-a';

    const deps: PrCacheDeps = {
        execFileSync: ((cmd, args, options) => {
            const commandArgs = Array.isArray(args)
                ? args.map(arg => String(arg))
                : [];
            execCalls.push({
                args: commandArgs,
                cmd,
                cwd: typeof options === 'object' && 'cwd' in options
                    ? String(options.cwd)
                    : undefined
            });

            if (cmd === 'git' && commandArgs[0] === 'branch')
                return `${currentRef}\n`;
            if (cmd === 'git' && commandArgs[0] === 'rev-parse')
                return 'abc123\n';
            if (cmd === 'gh' && commandArgs[0] === '--version')
                return 'gh version 2.0.0\n';
            if (cmd === 'gh' && commandArgs[0] === 'pr') {
                const response = ghResponses.shift();
                if (response instanceof Error)
                    throw response;
                return response ?? '';
            }

            throw new Error(`Unexpected command: ${cmd} ${commandArgs.join(' ')}`);
        }) as PrCacheDeps['execFileSync'],
        existsSync: (filePath => cacheFiles.has(String(filePath))) as PrCacheDeps['existsSync'],
        getHomedir: () => '/tmp/home',
        mkdirSync: (() => undefined) as PrCacheDeps['mkdirSync'],
        now: () => now,
        readFileSync: (filePath => cacheFiles.get(String(filePath))?.content ?? '') as PrCacheDeps['readFileSync'],
        statSync: (filePath => ({ mtimeMs: cacheFiles.get(String(filePath))?.mtimeMs ?? now })) as PrCacheDeps['statSync'],
        writeFileSync: ((filePath, content) => {
            const normalizedContent = typeof content === 'string'
                ? content
                : Buffer.isBuffer(content)
                    ? content.toString('utf8')
                    : '';
            cacheFiles.set(String(filePath), {
                content: normalizedContent,
                mtimeMs: now
            });
        }) as PrCacheDeps['writeFileSync']
    };

    return {
        cacheFiles,
        deps,
        execCalls,
        ghResponses,
        setCurrentRef: (ref: string) => {
            currentRef = ref;
        }
    };
}

describe('gh-pr-cache', () => {
    it('negative-caches failed gh PR lookups', () => {
        const harness = createHarness();
        harness.ghResponses.push(new Error('no pull request found'));

        expect(fetchPrData('/tmp/repo', harness.deps)).toBeNull();

        const ghCallsAfterFirstRender = harness.execCalls.filter(call => call.cmd === 'gh');
        expect(ghCallsAfterFirstRender).toHaveLength(2);

        const cachedMissEntry = [...harness.cacheFiles.values()].at(0);
        expect(cachedMissEntry?.content).toBe('');

        expect(fetchPrData('/tmp/repo', harness.deps)).toBeNull();

        const ghCallsAfterSecondRender = harness.execCalls.filter(call => call.cmd === 'gh');
        expect(ghCallsAfterSecondRender).toHaveLength(2);
    });

    it('uses a different cache entry for each checked-out branch', () => {
        const harness = createHarness();
        harness.ghResponses.push(JSON.stringify({
            number: 123,
            reviewDecision: '',
            state: 'OPEN',
            title: 'First PR',
            url: 'https://github.com/owner/repo/pull/123'
        }));

        expect(fetchPrData('/tmp/repo', harness.deps)).toEqual({
            number: 123,
            reviewDecision: '',
            state: 'OPEN',
            title: 'First PR',
            url: 'https://github.com/owner/repo/pull/123'
        });

        harness.setCurrentRef('feature/cache-b');
        harness.ghResponses.push(JSON.stringify({
            number: 456,
            reviewDecision: 'APPROVED',
            state: 'OPEN',
            title: 'Second PR',
            url: 'https://github.com/owner/repo/pull/456'
        }));

        expect(fetchPrData('/tmp/repo', harness.deps)).toEqual({
            number: 456,
            reviewDecision: 'APPROVED',
            state: 'OPEN',
            title: 'Second PR',
            url: 'https://github.com/owner/repo/pull/456'
        });

        const writtenCachePaths = [...harness.cacheFiles.keys()];
        expect(writtenCachePaths.length).toBe(2);
        expect(writtenCachePaths[0]).not.toBe(writtenCachePaths[1]);
        expect(writtenCachePaths[0]).toContain('/.cache/ccstatusline/pr/pr-');
        expect(writtenCachePaths[1]).toContain('/.cache/ccstatusline/pr/pr-');

        harness.setCurrentRef('feature/cache-a');
        expect(fetchPrData('/tmp/repo', harness.deps)).toEqual({
            number: 123,
            reviewDecision: '',
            state: 'OPEN',
            title: 'First PR',
            url: 'https://github.com/owner/repo/pull/123'
        });
        expect(harness.cacheFiles.size).toBe(2);

        const ghPrCalls = harness.execCalls.filter(
            call => call.cmd === 'gh' && call.args[0] === 'pr'
        );
        expect(ghPrCalls).toHaveLength(2);
    });
});

function createListHarness(): PrCacheHarness {
    const cacheFiles = new Map<string, FakeCacheFile>();
    const execCalls: { args: string[]; cmd: string; cwd?: string }[] = [];
    const ghResponses: (Error | string)[] = [];
    const now = 1_700_000_000_000;
    let currentRef = 'feature/list-a';
    let headSha = 'abc123';
    let remoteSha = 'def456';

    const deps: PrCacheDeps = {
        execFileSync: ((cmd, args, options) => {
            const commandArgs = Array.isArray(args)
                ? args.map(arg => String(arg))
                : [];
            execCalls.push({
                args: commandArgs,
                cmd,
                cwd: typeof options === 'object' && 'cwd' in options
                    ? String(options.cwd)
                    : undefined
            });

            if (cmd === 'git' && commandArgs[0] === 'branch')
                return `${currentRef}\n`;
            if (cmd === 'git' && commandArgs[0] === 'rev-parse' && commandArgs[1] === 'HEAD')
                return `${headSha}\n`;
            if (cmd === 'git' && commandArgs[0] === 'rev-parse' && commandArgs[1]?.startsWith('origin/'))
                return `${remoteSha}\n`;
            if (cmd === 'git' && commandArgs[0] === 'rev-parse')
                return `${headSha}\n`;
            if (cmd === 'gh' && commandArgs[0] === '--version')
                return 'gh version 2.0.0\n';
            if (cmd === 'gh' && commandArgs[0] === 'pr') {
                const response = ghResponses.shift();
                if (response instanceof Error)
                    throw response;
                return response ?? '';
            }

            throw new Error(`Unexpected command: ${cmd} ${commandArgs.join(' ')}`);
        }) as PrCacheDeps['execFileSync'],
        existsSync: (filePath => cacheFiles.has(String(filePath))) as PrCacheDeps['existsSync'],
        getHomedir: () => '/tmp/home',
        mkdirSync: (() => undefined) as PrCacheDeps['mkdirSync'],
        now: () => now,
        readFileSync: (filePath => cacheFiles.get(String(filePath))?.content ?? '') as PrCacheDeps['readFileSync'],
        statSync: (filePath => ({ mtimeMs: cacheFiles.get(String(filePath))?.mtimeMs ?? now })) as PrCacheDeps['statSync'],
        writeFileSync: ((filePath, content) => {
            const normalizedContent = typeof content === 'string'
                ? content
                : Buffer.isBuffer(content)
                    ? content.toString('utf8')
                    : '';
            cacheFiles.set(String(filePath), {
                content: normalizedContent,
                mtimeMs: now
            });
        }) as PrCacheDeps['writeFileSync']
    };

    return {
        cacheFiles,
        deps,
        execCalls,
        ghResponses,
        setCurrentRef: (ref: string) => {
            currentRef = ref;
            headSha = `sha-${ref}`;
            remoteSha = `remote-${ref}`;
        }
    };
}

describe('fetchPrListData', () => {
    it('fetches and caches multi-PR list data', () => {
        const harness = createListHarness();
        harness.ghResponses.push(JSON.stringify([
            {
                baseRefName: 'main',
                mergeable: 'MERGEABLE',
                number: 10,
                reviewDecision: 'APPROVED',
                state: 'OPEN',
                title: 'PR to main',
                url: 'https://github.com/owner/repo/pull/10'
            },
            {
                baseRefName: 'develop',
                mergeable: 'CONFLICTING',
                number: 11,
                reviewDecision: '',
                state: 'OPEN',
                title: 'PR to develop',
                url: 'https://github.com/owner/repo/pull/11'
            }
        ]));

        const result = fetchPrListData('/tmp/repo', harness.deps);
        expect(result).toHaveLength(2);
        expect(result?.[0]?.number).toBe(10);
        expect(result?.[0]?.baseRefName).toBe('main');
        expect(result?.[1]?.mergeable).toBe('CONFLICTING');

        // Second call should use cache
        const result2 = fetchPrListData('/tmp/repo', harness.deps);
        expect(result2).toEqual(result);

        const ghPrCalls = harness.execCalls.filter(
            call => call.cmd === 'gh' && call.args[0] === 'pr'
        );
        expect(ghPrCalls).toHaveLength(1);
    });

    it('negative-caches when no PRs found', () => {
        const harness = createListHarness();
        harness.ghResponses.push('[]');

        expect(fetchPrListData('/tmp/repo', harness.deps)).toBeNull();

        // Second call uses negative cache
        expect(fetchPrListData('/tmp/repo', harness.deps)).toBeNull();

        const ghPrCalls = harness.execCalls.filter(
            call => call.cmd === 'gh' && call.args[0] === 'pr'
        );
        expect(ghPrCalls).toHaveLength(1);
    });

    it('negative-caches when gh command fails', () => {
        const harness = createListHarness();
        harness.ghResponses.push(new Error('network error'));

        expect(fetchPrListData('/tmp/repo', harness.deps)).toBeNull();
    });
});

describe('getExtendedPrStatusLabel', () => {
    it('returns CONFLICT when mergeable is CONFLICTING', () => {
        expect(getExtendedPrStatusLabel('OPEN', '', 'CONFLICTING')).toBe('CONFLICT');
    });

    it('returns MERGED for merged PRs regardless of mergeable', () => {
        expect(getExtendedPrStatusLabel('MERGED', '', 'CONFLICTING')).toBe('MERGED');
    });

    it('returns APPROVED when review is approved', () => {
        expect(getExtendedPrStatusLabel('OPEN', 'APPROVED', 'MERGEABLE')).toBe('APPROVED');
    });

    it('returns REVIEW for review required', () => {
        expect(getExtendedPrStatusLabel('OPEN', 'REVIEW_REQUIRED', 'MERGEABLE')).toBe('REVIEW');
    });

    it('returns CHANGES_REQ for changes requested', () => {
        expect(getExtendedPrStatusLabel('OPEN', 'CHANGES_REQUESTED', 'MERGEABLE')).toBe('CHANGES_REQ');
    });
});

describe('shortenBranch', () => {
    it('keeps short names as-is', () => {
        expect(shortenBranch('main')).toBe('main');
        expect(shortenBranch('dev')).toBe('dev');
    });

    it('takes initials from hyphen-separated names', () => {
        expect(shortenBranch('feature-branch')).toBe('fb');
    });

    it('takes initials from slash-separated names', () => {
        expect(shortenBranch('feature/new-widget')).toBe('fnw');
    });

    it('truncates to 4 chars for long names without separators', () => {
        expect(shortenBranch('development')).toBe('deve');
    });
});