import {
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { renderOsc8Link } from '../../utils/hyperlink';
import {
    GitPrWidget,
    type GitPrWidgetDeps
} from '../GitPr';

const SAMPLE_PR = {
    number: 123,
    reviewDecision: '',
    state: 'OPEN',
    title: 'Fix authentication bug',
    url: 'https://github.com/owner/repo/pull/123'
};

function createDeps(overrides: Partial<GitPrWidgetDeps> = {}): GitPrWidgetDeps {
    return {
        fetchPrData: () => SAMPLE_PR,
        fetchPrListData: () => null,
        getProcessCwd: () => '/tmp/process-cwd',
        isInsideGitWorkTree: () => true,
        resolveGitCwd: context => context.data?.cwd,
        ...overrides
    };
}

function render(
    options: {
        cwd?: string;
        hideNoGit?: boolean;
        hideStatus?: boolean;
        hideTitle?: boolean;
        isPreview?: boolean;
        rawValue?: boolean;
    } = {},
    depOverrides: Partial<GitPrWidgetDeps> = {}
): string | null {
    const widget = new GitPrWidget(createDeps(depOverrides));
    const context: RenderContext = {
        data: options.cwd ? { cwd: options.cwd } : undefined,
        isPreview: options.isPreview
    };
    const metadata: Record<string, string> = {};
    if (options.hideNoGit)
        metadata.hideNoGit = 'true';
    if (options.hideStatus)
        metadata.hideStatus = 'true';
    if (options.hideTitle)
        metadata.hideTitle = 'true';

    const item: WidgetItem = {
        id: 'git-pr',
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        rawValue: options.rawValue,
        type: 'git-pr'
    };

    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('GitPrWidget', () => {
    it('should render preview with OSC 8 link', () => {
        const result = render({ isPreview: true });
        expect(result).toBe(
            `${renderOsc8Link('https://github.com/owner/repo/pull/42', 'PR #42')} OPEN Example PR title`
        );
    });

    it('should render preview with rawValue', () => {
        const result = render({ isPreview: true, rawValue: true });
        expect(result).toBe(
            `${renderOsc8Link('https://github.com/owner/repo/pull/42', '#42')} OPEN Example PR title`
        );
    });

    it('should render preview without status when hideStatus enabled', () => {
        const result = render({ isPreview: true, hideStatus: true });
        expect(result).toBe(
            `${renderOsc8Link('https://github.com/owner/repo/pull/42', 'PR #42')} Example PR title`
        );
    });

    it('should render preview without title when hideTitle enabled', () => {
        const result = render({ isPreview: true, hideTitle: true });
        expect(result).toBe(
            `${renderOsc8Link('https://github.com/owner/repo/pull/42', 'PR #42')} OPEN`
        );
    });

    it('should render full PR display when PR data is available', () => {
        const result = render({ cwd: '/tmp/repo' });
        expect(result).toBe(
            `${renderOsc8Link('https://github.com/owner/repo/pull/123', 'PR #123')} OPEN Fix authentication bug`
        );
    });

    it('should return (no PR) when not in git repo', () => {
        expect(render({ cwd: '/tmp/not-a-repo' }, { isInsideGitWorkTree: () => false })).toBe('(no PR)');
    });

    it('should return null when hideNoGit and not in git repo', () => {
        expect(render({ cwd: '/tmp/not-a-repo', hideNoGit: true }, { isInsideGitWorkTree: () => false })).toBeNull();
    });

    it('should return (no PR) when PR lookup returns null', () => {
        expect(render({}, {
            fetchPrData: () => null,
            resolveGitCwd: () => undefined
        })).toBe('(no PR)');
    });

    it('should use process cwd when repo paths are omitted', () => {
        const fetchPrData = vi.fn(() => SAMPLE_PR);

        const result = render({}, {
            fetchPrData,
            getProcessCwd: () => '/tmp/process-cwd',
            resolveGitCwd: () => undefined
        });

        expect(result).toBe(
            `${renderOsc8Link('https://github.com/owner/repo/pull/123', 'PR #123')} OPEN Fix authentication bug`
        );
        expect(fetchPrData).toHaveBeenCalledWith('/tmp/process-cwd');
    });

    it('should truncate long titles', () => {
        const longPr = {
            ...SAMPLE_PR,
            title: 'This is a very long pull request title that exceeds the default limit'
        };

        const result = render({ cwd: '/tmp/repo' }, { fetchPrData: () => longPr });
        expect(result).toContain('This is a very long pull requ\u2026');
    });

    it('should render MERGED status', () => {
        expect(render({ cwd: '/tmp/repo' }, { fetchPrData: () => ({ ...SAMPLE_PR, state: 'MERGED' }) })).toContain('MERGED');
    });

    it('should render APPROVED status', () => {
        expect(render({ cwd: '/tmp/repo' }, {
            fetchPrData: () => ({
                ...SAMPLE_PR,
                reviewDecision: 'APPROVED',
                state: 'OPEN'
            })
        })).toContain('APPROVED');
    });

    it('should render CHANGES_REQ status', () => {
        expect(render({ cwd: '/tmp/repo' }, {
            fetchPrData: () => ({
                ...SAMPLE_PR,
                reviewDecision: 'CHANGES_REQUESTED',
                state: 'OPEN'
            })
        })).toContain('CHANGES_REQ');
    });
});

const SAMPLE_PR_EXTENDED = {
    ...SAMPLE_PR,
    baseRefName: 'main',
    mergeable: 'MERGEABLE'
};

function renderMultiPr(
    options: {
        cwd?: string;
        hideNoGit?: boolean;
        hideStatus?: boolean;
        hideTitle?: boolean;
        isPreview?: boolean;
        multiPr?: boolean;
        rawValue?: boolean;
        showBaseBranch?: boolean;
        showMergeable?: boolean;
    } = {},
    depOverrides: Partial<GitPrWidgetDeps> = {}
): string | null {
    const widget = new GitPrWidget(createDeps(depOverrides));
    const context: RenderContext = {
        data: options.cwd ? { cwd: options.cwd } : undefined,
        isPreview: options.isPreview
    };
    const metadata: Record<string, string> = {};
    if (options.hideNoGit)
        metadata.hideNoGit = 'true';
    if (options.hideStatus)
        metadata.hideStatus = 'true';
    if (options.hideTitle)
        metadata.hideTitle = 'true';
    if (options.multiPr)
        metadata.multiPr = 'true';
    if (options.showBaseBranch)
        metadata.showBaseBranch = 'true';
    if (options.showMergeable)
        metadata.showMergeable = 'true';

    const item: WidgetItem = {
        id: 'git-pr',
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        rawValue: options.rawValue,
        type: 'git-pr'
    };

    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('GitPrWidget multi-PR mode', () => {
    it('should render multiple PRs separated by pipe', () => {
        const prList = [
            { ...SAMPLE_PR_EXTENDED, number: 10, title: 'PR to main', url: 'https://github.com/o/r/pull/10' },
            { ...SAMPLE_PR_EXTENDED, baseRefName: 'develop', number: 11, title: 'PR to dev', url: 'https://github.com/o/r/pull/11' }
        ];

        const result = renderMultiPr(
            { cwd: '/tmp/repo', multiPr: true },
            { fetchPrListData: () => prList }
        );

        expect(result).toContain('PR #10');
        expect(result).toContain('PR #11');
        expect(result).toContain(' | ');
    });

    it('should show base branch when enabled', () => {
        const result = renderMultiPr(
            { cwd: '/tmp/repo', multiPr: true, showBaseBranch: true },
            { fetchPrListData: () => [SAMPLE_PR_EXTENDED] }
        );

        expect(result).toContain('\u2192main');
    });

    it('should show CONFLICT status when mergeable enabled', () => {
        const conflictPr = { ...SAMPLE_PR_EXTENDED, mergeable: 'CONFLICTING' };
        const result = renderMultiPr(
            { cwd: '/tmp/repo', multiPr: true, showMergeable: true },
            { fetchPrListData: () => [conflictPr] }
        );

        expect(result).toContain('CONFLICT');
    });

    it('should return (no PR) when fetchPrListData returns null', () => {
        const result = renderMultiPr(
            { cwd: '/tmp/repo', multiPr: true },
            { fetchPrListData: () => null }
        );

        expect(result).toBe('(no PR)');
    });

    it('should return null when hideNoGit and no PRs in multi mode', () => {
        const result = renderMultiPr(
            { cwd: '/tmp/repo', hideNoGit: true, multiPr: true },
            { fetchPrListData: () => null, isInsideGitWorkTree: () => false }
        );

        expect(result).toBeNull();
    });

    it('should fall back to single PR mode when multiPr is not enabled', () => {
        const result = renderMultiPr(
            { cwd: '/tmp/repo' },
            { fetchPrData: () => SAMPLE_PR }
        );

        expect(result).toContain('PR #123');
        expect(result).not.toContain(' | ');
    });
});