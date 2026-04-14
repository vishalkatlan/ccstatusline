import type * as fs from 'fs';
import {
    describe,
    expect,
    it
} from 'vitest';

import {
    discoverNestedRepos,
    type NestedRepoDeps
} from '../nested-repos';

function makeDirent(name: string, isDir: boolean): fs.Dirent {
    return {
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        isSymbolicLink: () => false,
        name,
        parentPath: '/test',
        path: '/test'
    } as fs.Dirent;
}

interface HarnessOptions {
    cwdIsGitRepo?: boolean;
    entries?: fs.Dirent[];
    gitRepoDirs?: Set<string>;
}

function createHarness(options: HarnessOptions = {}): NestedRepoDeps {
    const { cwdIsGitRepo = false, entries = [], gitRepoDirs = new Set<string>() } = options;

    return {
        execFileSync: ((_cmd, args, opts) => {
            const cwd = (opts as { cwd?: string }).cwd ?? '';
            if (Array.isArray(args) && args[0] === 'rev-parse') {
                if (cwdIsGitRepo && cwd === '/test') {
                    return 'true\n';
                }
                if (gitRepoDirs.has(cwd)) {
                    return 'true\n';
                }
                throw new Error('not a git repo');
            }
            throw new Error('unexpected command');
        }) as NestedRepoDeps['execFileSync'],
        readdirSync: (() => entries) as unknown as NestedRepoDeps['readdirSync']
    };
}

describe('discoverNestedRepos', () => {
    it('returns empty when cwd is itself a git repo', () => {
        const deps = createHarness({
            cwdIsGitRepo: true,
            entries: [makeDirent('sub-repo', true)],
            gitRepoDirs: new Set(['/test/sub-repo'])
        });

        expect(discoverNestedRepos('/test', deps)).toEqual([]);
    });

    it('returns empty when no subdirectories exist', () => {
        const deps = createHarness({ entries: [] });
        expect(discoverNestedRepos('/test', deps)).toEqual([]);
    });

    it('returns empty when no subdirectories are git repos', () => {
        const deps = createHarness({
            entries: [
                makeDirent('plain-dir', true),
                makeDirent('another-dir', true)
            ]
        });

        expect(discoverNestedRepos('/test', deps)).toEqual([]);
    });

    it('discovers git repos among subdirectories', () => {
        const deps = createHarness({
            entries: [
                makeDirent('backend', true),
                makeDirent('frontend', true),
                makeDirent('docs', true)
            ],
            gitRepoDirs: new Set(['/test/backend', '/test/frontend'])
        });

        expect(discoverNestedRepos('/test', deps)).toEqual([
            { name: 'backend', path: '/test/backend' },
            { name: 'frontend', path: '/test/frontend' }
        ]);
    });

    it('skips hidden directories', () => {
        const deps = createHarness({
            entries: [
                makeDirent('.hidden', true),
                makeDirent('visible', true)
            ],
            gitRepoDirs: new Set(['/test/.hidden', '/test/visible'])
        });

        expect(discoverNestedRepos('/test', deps)).toEqual([
            { name: 'visible', path: '/test/visible' }
        ]);
    });

    it('skips non-directory entries', () => {
        const deps = createHarness({
            entries: [
                makeDirent('file.txt', false),
                makeDirent('repo', true)
            ],
            gitRepoDirs: new Set(['/test/repo'])
        });

        expect(discoverNestedRepos('/test', deps)).toEqual([
            { name: 'repo', path: '/test/repo' }
        ]);
    });

    it('returns results sorted alphabetically', () => {
        const deps = createHarness({
            entries: [
                makeDirent('zebra', true),
                makeDirent('alpha', true),
                makeDirent('middle', true)
            ],
            gitRepoDirs: new Set(['/test/zebra', '/test/alpha', '/test/middle'])
        });

        expect(discoverNestedRepos('/test', deps)).toEqual([
            { name: 'alpha', path: '/test/alpha' },
            { name: 'middle', path: '/test/middle' },
            { name: 'zebra', path: '/test/zebra' }
        ]);
    });

    it('caps scanning at 20 directories', () => {
        const entries = Array.from({ length: 25 }, (_, i) => makeDirent(`dir-${String(i).padStart(2, '0')}`, true));
        const allDirs = new Set(entries.map(e => `/test/${e.name}`));
        const deps = createHarness({ entries, gitRepoDirs: allDirs });

        const result = discoverNestedRepos('/test', deps);
        expect(result.length).toBeLessThanOrEqual(20);
    });

    it('returns empty when readdirSync throws', () => {
        const deps: NestedRepoDeps = {
            execFileSync: (() => { throw new Error('not a git repo'); }) as NestedRepoDeps['execFileSync'],
            readdirSync: () => { throw new Error('ENOENT'); }
        };

        expect(discoverNestedRepos('/nonexistent', deps)).toEqual([]);
    });
});