import chalk from 'chalk';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import type { PrDataExtended } from '../utils/gh-pr-cache';
import {
    fetchPrListData,
    getExtendedPrStatusLabel,
    shortenBranch
} from '../utils/gh-pr-cache';
import {
    clearGitCache,
    getGitStatus,
    isInsideGitWorkTree,
    resolveGitCwd,
    runGit
} from '../utils/git';
import {
    encodeGitRefForUrlPath,
    parseGitHubBaseUrl,
    renderOsc8Link
} from '../utils/hyperlink';
import { discoverNestedRepos } from '../utils/nested-repos';

interface RepoLine {
    repoName: string | null;
    branch: string;
    staged: string;
    unstaged: string;
    untracked: number;
    conflicts: boolean;
    prs: PrDataExtended[];
    remoteUrl: string | null;
}

function coloredChanges(label: string, value: string, isZero: boolean): string {
    const colored = isZero ? chalk.dim(value) : chalk.red(value);
    return `${chalk.dim(label)}${colored}`;
}

function formatPr(pr: PrDataExtended): string {
    const num = renderOsc8Link(pr.url, `#${pr.number}`);
    const status = getExtendedPrStatusLabel(pr.state, pr.reviewDecision, pr.mergeable);
    const base = pr.baseRefName.length > 0 ? `${chalk.dim('\u2192')}${chalk.dim(shortenBranch(pr.baseRefName))}` : '';

    let statusColor: string;
    switch (status) {
        case 'MERGED':
            statusColor = chalk.magenta(status);
            break;
        case 'CLOSED':
            statusColor = chalk.red(status);
            break;
        case 'CONFLICT':
            statusColor = chalk.red(status);
            break;
        case 'APPROVED':
            statusColor = chalk.green(status);
            break;
        case 'REVIEW':
            statusColor = chalk.cyan(status);
            break;
        case 'CHANGES_REQ':
            statusColor = chalk.yellow(status);
            break;
        default:
            statusColor = chalk.dim(status);
            break;
    }

    return `${num}${base} ${statusColor}`;
}

function buildRepoLine(info: RepoLine): string {
    const parts: string[] = [];

    // Repo name (only in multi-repo mode)
    if (info.repoName !== null) {
        parts.push(chalk.cyan(info.repoName));
    }

    // Branch with hyperlink
    let branchText = `\u2387 ${info.branch}`;
    if (info.remoteUrl) {
        const baseUrl = parseGitHubBaseUrl(info.remoteUrl);
        if (baseUrl) {
            branchText = renderOsc8Link(`${baseUrl}/tree/${encodeGitRefForUrlPath(info.branch)}`, branchText);
        }
    }
    parts.push(chalk.magenta(branchText));

    // Staged
    const stagedZero = info.staged === '+0,-0';
    parts.push(coloredChanges('S(', info.staged, stagedZero) + chalk.dim(')'));

    // Unstaged
    const unstagedZero = info.unstaged === '+0,-0';
    parts.push(coloredChanges('U(', info.unstaged, unstagedZero) + chalk.dim(')'));

    // Untracked
    const untrackedText = `?:${info.untracked}`;
    parts.push(info.untracked === 0 ? chalk.dim(untrackedText) : chalk.yellow(untrackedText));

    // Conflicts
    if (info.conflicts) {
        parts.push(chalk.red('!CONFLICTS'));
    }

    // PRs
    if (info.prs.length > 0) {
        const prParts = info.prs.map(pr => formatPr(pr));
        parts.push(chalk.dim('|'));
        parts.push(prParts.join(` ${chalk.dim('|')} `));
    }

    return parts.join(' ');
}

function collectStagedUnstaged(context: RenderContext): { staged: string; unstaged: string } {
    const stagedStat = runGit('diff --cached --shortstat', context) ?? '';
    const unstagedStat = runGit('diff --shortstat', context) ?? '';

    const parseShortStat = (stat: string): string => {
        const insertMatch = /(\d+)\s+insertions?/.exec(stat);
        const deleteMatch = /(\d+)\s+deletions?/.exec(stat);
        const ins = insertMatch?.[1] ? parseInt(insertMatch[1], 10) : 0;
        const del = deleteMatch?.[1] ? parseInt(deleteMatch[1], 10) : 0;
        return `+${ins},-${del}`;
    };

    return {
        staged: parseShortStat(stagedStat),
        unstaged: parseShortStat(unstagedStat)
    };
}

function collectRepoInfoFull(cwd: string, context: RenderContext, repoName: string | null): RepoLine {
    const branch = runGit('branch --show-current', context) ?? 'detached';
    const { staged, unstaged } = collectStagedUnstaged(context);
    const status = getGitStatus(context);
    const remoteUrl = runGit('remote get-url origin', context);
    const prs = fetchPrListData(cwd) ?? [];

    const untrackedOutput = runGit('ls-files --others --exclude-standard', context);
    const untracked = untrackedOutput ? untrackedOutput.split('\n').filter(l => l.length > 0).length : 0;

    return {
        repoName,
        branch,
        staged,
        unstaged,
        untracked,
        conflicts: status.conflicts,
        prs,
        remoteUrl
    };
}

export class GitWorkspaceWidget implements Widget {
    getDefaultColor(): string { return 'white'; }
    getDescription(): string { return 'Multi-line git workspace overview (one line per repo with branch, status, PRs)'; }
    getDisplayName(): string { return 'Git Workspace'; }
    getCategory(): string { return 'Git'; }
    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(_item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview) {
            return [
                `${chalk.cyan('frontend')} ${chalk.magenta('\u2387 main')} ${chalk.dim('S(+0,-0)')} ${chalk.dim('U(+0,-0)')} ${chalk.dim('?:0')}`,
                `${chalk.cyan('backend')} ${chalk.magenta('\u2387 feat/api')} ${chalk.dim('S(')}${chalk.red('+5,-2')}${chalk.dim(')')} ${chalk.dim('U(+0,-0)')} ${chalk.yellow('?:1')} ${chalk.dim('|')} #42 ${chalk.green('APPROVED')}`
            ].join('\n');
        }

        const cwd = resolveGitCwd(context);
        if (!cwd) {
            return null;
        }

        if (isInsideGitWorkTree(context)) {
            // Single repo mode
            const info = collectRepoInfoFull(cwd, context, null);
            return buildRepoLine(info);
        }

        // Multi-repo mode
        const repos = discoverNestedRepos(cwd);
        if (repos.length === 0) {
            return null;
        }

        const lines: string[] = [];
        for (const repo of repos) {
            clearGitCache();
            const repoContext: RenderContext = {
                ...context,
                data: { ...context.data, cwd: repo.path }
            };
            const info = collectRepoInfoFull(repo.path, repoContext, repo.name);
            lines.push(buildRepoLine(info));
        }

        return lines.join('\n');
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(_item: WidgetItem): boolean { return false; }
}