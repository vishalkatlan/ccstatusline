import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import type {
    PrData,
    PrDataExtended
} from '../utils/gh-pr-cache';
import {
    fetchPrData,
    fetchPrListData,
    getExtendedPrStatusLabel,
    getPrStatusLabel,
    shortenBranch,
    truncateTitle
} from '../utils/gh-pr-cache';
import {
    isInsideGitWorkTree,
    resolveGitCwd
} from '../utils/git';
import { renderOsc8Link } from '../utils/hyperlink';

import { makeModifierText } from './shared/editor-display';
import {
    getHideNoGitKeybinds,
    getHideNoGitModifierText,
    handleToggleNoGitAction,
    isHideNoGitEnabled
} from './shared/git-no-git';
import {
    isMetadataFlagEnabled,
    toggleMetadataFlag
} from './shared/metadata';

const HIDE_STATUS_KEY = 'hideStatus';
const HIDE_TITLE_KEY = 'hideTitle';
const SHOW_BASE_BRANCH_KEY = 'showBaseBranch';
const SHOW_MERGEABLE_KEY = 'showMergeable';
const MULTI_PR_KEY = 'multiPr';
const TOGGLE_STATUS_ACTION = 'toggle-status';
const TOGGLE_TITLE_ACTION = 'toggle-title';
const TOGGLE_BASE_BRANCH_ACTION = 'toggle-base-branch';
const TOGGLE_MERGEABLE_ACTION = 'toggle-mergeable';
const TOGGLE_MULTI_PR_ACTION = 'toggle-multi-pr';

export interface GitPrWidgetDeps {
    fetchPrData: typeof fetchPrData;
    fetchPrListData: typeof fetchPrListData;
    getProcessCwd: typeof process.cwd;
    isInsideGitWorkTree: typeof isInsideGitWorkTree;
    resolveGitCwd: typeof resolveGitCwd;
}

const DEFAULT_GIT_PR_WIDGET_DEPS: GitPrWidgetDeps = {
    fetchPrData,
    fetchPrListData,
    getProcessCwd: () => process.cwd(),
    isInsideGitWorkTree,
    resolveGitCwd
};

const PREVIEW_PR: PrDataExtended = {
    number: 42,
    url: 'https://github.com/owner/repo/pull/42',
    title: 'Example PR title',
    state: 'OPEN',
    reviewDecision: '',
    baseRefName: 'main',
    mergeable: 'MERGEABLE'
};

function buildSinglePrDisplay(
    item: WidgetItem,
    pr: PrData,
    showStatus: boolean,
    showTitle: boolean
): string {
    const linkText = item.rawValue ? `#${pr.number}` : `PR #${pr.number}`;
    const parts: string[] = [renderOsc8Link(pr.url, linkText)];

    if (showStatus) {
        const status = getPrStatusLabel(pr.state, pr.reviewDecision);
        if (status.length > 0) {
            parts.push(status);
        }
    }

    if (showTitle && pr.title.length > 0) {
        parts.push(truncateTitle(pr.title));
    }

    return parts.join(' ');
}

function buildExtendedPrDisplay(
    item: WidgetItem,
    pr: PrDataExtended,
    showStatus: boolean,
    showTitle: boolean,
    showBaseBranch: boolean,
    showMergeable: boolean
): string {
    const linkText = item.rawValue ? `#${pr.number}` : `PR #${pr.number}`;
    const parts: string[] = [renderOsc8Link(pr.url, linkText)];

    if (showStatus) {
        const status = showMergeable
            ? getExtendedPrStatusLabel(pr.state, pr.reviewDecision, pr.mergeable)
            : getPrStatusLabel(pr.state, pr.reviewDecision);
        if (status.length > 0) {
            parts.push(status);
        }
    }

    if (showBaseBranch && pr.baseRefName.length > 0) {
        parts.push(`\u2192${shortenBranch(pr.baseRefName)}`);
    }

    if (showTitle && pr.title.length > 0) {
        parts.push(truncateTitle(pr.title));
    }

    return parts.join(' ');
}

function buildMultiPrDisplay(
    item: WidgetItem,
    prs: PrDataExtended[],
    showStatus: boolean,
    showTitle: boolean,
    showBaseBranch: boolean,
    showMergeable: boolean
): string {
    return prs.map(pr => buildExtendedPrDisplay(item, pr, showStatus, showTitle, showBaseBranch, showMergeable)).join(' | ');
}

export class GitPrWidget implements Widget {
    constructor(private readonly deps: GitPrWidgetDeps = DEFAULT_GIT_PR_WIDGET_DEPS) {}

    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows PR info for the current branch (clickable link, status, title)'; }
    getDisplayName(): string { return 'Git PR'; }
    getCategory(): string { return 'Git'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const modifiers: string[] = [];
        const noGitText = getHideNoGitModifierText(item);
        if (noGitText)
            modifiers.push('hide \'no git\'');
        if (isMetadataFlagEnabled(item, HIDE_STATUS_KEY))
            modifiers.push('no status');
        if (isMetadataFlagEnabled(item, HIDE_TITLE_KEY))
            modifiers.push('no title');
        if (isMetadataFlagEnabled(item, MULTI_PR_KEY))
            modifiers.push('multi-PR');
        if (isMetadataFlagEnabled(item, SHOW_BASE_BRANCH_KEY))
            modifiers.push('base branch');
        if (isMetadataFlagEnabled(item, SHOW_MERGEABLE_KEY))
            modifiers.push('mergeable');
        return {
            displayText: this.getDisplayName(),
            modifierText: makeModifierText(modifiers)
        };
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === TOGGLE_STATUS_ACTION) {
            return toggleMetadataFlag(item, HIDE_STATUS_KEY);
        }
        if (action === TOGGLE_TITLE_ACTION) {
            return toggleMetadataFlag(item, HIDE_TITLE_KEY);
        }
        if (action === TOGGLE_BASE_BRANCH_ACTION) {
            return toggleMetadataFlag(item, SHOW_BASE_BRANCH_KEY);
        }
        if (action === TOGGLE_MERGEABLE_ACTION) {
            return toggleMetadataFlag(item, SHOW_MERGEABLE_KEY);
        }
        if (action === TOGGLE_MULTI_PR_ACTION) {
            return toggleMetadataFlag(item, MULTI_PR_KEY);
        }
        return handleToggleNoGitAction(action, item);
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        void settings;
        const hideNoGit = isHideNoGitEnabled(item);
        const showStatus = !isMetadataFlagEnabled(item, HIDE_STATUS_KEY);
        const showTitle = !isMetadataFlagEnabled(item, HIDE_TITLE_KEY);
        const multiPr = isMetadataFlagEnabled(item, MULTI_PR_KEY);
        const showBaseBranch = isMetadataFlagEnabled(item, SHOW_BASE_BRANCH_KEY);
        const showMergeable = isMetadataFlagEnabled(item, SHOW_MERGEABLE_KEY);

        if (context.isPreview) {
            if (multiPr) {
                return buildMultiPrDisplay(item, [PREVIEW_PR], showStatus, showTitle, showBaseBranch, showMergeable);
            }
            return buildSinglePrDisplay(item, PREVIEW_PR, showStatus, showTitle);
        }

        if (!this.deps.isInsideGitWorkTree(context)) {
            return hideNoGit ? null : '(no PR)';
        }

        const cwd = this.deps.resolveGitCwd(context) ?? this.deps.getProcessCwd();

        if (multiPr) {
            const prList = this.deps.fetchPrListData(cwd);
            if (!prList || prList.length === 0) {
                return hideNoGit ? null : '(no PR)';
            }
            return buildMultiPrDisplay(item, prList, showStatus, showTitle, showBaseBranch, showMergeable);
        }

        const prData = this.deps.fetchPrData(cwd);
        if (!prData) {
            return hideNoGit ? null : '(no PR)';
        }
        return buildSinglePrDisplay(item, prData, showStatus, showTitle);
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            ...getHideNoGitKeybinds(),
            { key: 's', label: '(s)tatus', action: TOGGLE_STATUS_ACTION },
            { key: 't', label: '(t)itle', action: TOGGLE_TITLE_ACTION },
            { key: 'b', label: '(b)ase branch', action: TOGGLE_BASE_BRANCH_ACTION },
            { key: 'm', label: '(m)ergeable', action: TOGGLE_MERGEABLE_ACTION },
            { key: 'p', label: 'multi-(p)r', action: TOGGLE_MULTI_PR_ACTION }
        ];
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}