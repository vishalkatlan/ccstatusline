import { execFileSync } from 'child_process';
import type { Dirent } from 'fs';
import { readdirSync } from 'fs';
import path from 'path';

export interface NestedRepo {
    name: string;
    path: string;
}

const MAX_SCAN_DIRS = 20;

export interface NestedRepoDeps {
    execFileSync: typeof execFileSync;
    readdirSync: typeof readdirSync;
}

const DEFAULT_DEPS: NestedRepoDeps = {
    execFileSync,
    readdirSync
};

function isGitRepo(dirPath: string, deps: NestedRepoDeps): boolean {
    try {
        const result = deps.execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            cwd: dirPath,
            timeout: 5_000
        }).trim();
        return result === 'true';
    } catch {
        return false;
    }
}

export function discoverNestedRepos(cwd: string, deps: NestedRepoDeps = DEFAULT_DEPS): NestedRepo[] {
    // If cwd itself is a git repo, don't scan for nested repos
    if (isGitRepo(cwd, deps)) {
        return [];
    }

    let entries: Dirent[];
    try {
        entries = deps.readdirSync(cwd, { withFileTypes: true });
    } catch {
        return [];
    }

    const dirs = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .slice(0, MAX_SCAN_DIRS);

    const repos: NestedRepo[] = [];
    for (const dir of dirs) {
        const dirPath = path.join(cwd, dir.name);
        if (isGitRepo(dirPath, deps)) {
            repos.push({ name: dir.name, path: dirPath });
        }
    }

    return repos.sort((a, b) => a.name.localeCompare(b.name));
}