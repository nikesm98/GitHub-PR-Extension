import * as vscode from 'vscode';
import type { GitHubAPI } from '../github/api';
import type { PR } from '../github/types';
import { Logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Git Types for vscode.git built-in extension
// ---------------------------------------------------------------------------

export interface GitExtension {
  enabled: boolean;
  getAPI(version: number): API;
}

export interface API {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
}

export interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
}

export interface RepositoryState {
  remotes: Remote[];
  HEAD: Branch | undefined;
  onDidChange: vscode.Event<void>;
}

export interface Remote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface Branch {
  name?: string;
  commit?: string;
}

export interface LocalRepo {
  owner: string;
  name: string;
  uri: vscode.Uri;
}

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

type TreeNode = RepoNode | FolderNode | PRNode | MessageNode;

interface RepoNode {
  kind: 'repo';
  repo: LocalRepo;
}

interface FolderNode {
  kind: 'folder';
  label: string;
  state: 'open' | 'closed';
  repo: LocalRepo;
}

interface PRNode {
  kind: 'pr';
  pr: PR;
}

interface MessageNode {
  kind: 'message';
  text: string;
  tooltip?: string;
}

// ---------------------------------------------------------------------------
// Helper - Git Remote URL Parsing
// ---------------------------------------------------------------------------

function parseGitRemoteUrl(url: string): { owner: string; repo: string } | null {
  let cleanUrl = url.trim();
  if (cleanUrl.endsWith('.git')) {
    cleanUrl = cleanUrl.substring(0, cleanUrl.length - 4);
  }

  // Matches:
  // - https://github.com/owner/repo
  // - git@github.com:owner/repo
  // - ssh://git@github.com/owner/repo
  const githubRegex = /(?:github\.com[:/])([^/]+)\/([^/]+)$/;
  const match = cleanUrl.match(githubRegex);
  if (match) {
    return {
      owner: match[1],
      repo: match[2],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tree data provider
// ---------------------------------------------------------------------------

/**
 * Provides the sidebar tree view with the hierarchy:
 *   Repository -> Open/Closed PRs -> PR item
 */
export class PRTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repositories: LocalRepo[] = [];
  private isLoading = false;
  private gitDisposables: vscode.Disposable[] = [];

  constructor(private api: GitHubAPI) {
    this.bindGitEvents();
  }

  // -----------------------------------------------------------------------
  // TreeDataProvider implementation
  // -----------------------------------------------------------------------

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'repo':
        return this.createRepoItem(element.repo);
      case 'folder':
        return this.createFolderItem(element.repo, element.label, element.state);
      case 'pr':
        return this.createPRItem(element.pr);
      case 'message':
        return this.createMessageItem(element.text, element.tooltip);
    }
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    // Root level: show repositories
    if (!element) {
      return this.getRootChildren();
    }

    // Repository level: show Open and Closed PR folders
    if (element.kind === 'repo') {
      return [
        {
          kind: 'folder',
          label: 'Open Pull Requests',
          state: 'open',
          repo: element.repo,
        },
        {
          kind: 'folder',
          label: 'Closed Pull Requests',
          state: 'closed',
          repo: element.repo,
        },
      ];
    }

    // Folder level: show PRs
    if (element.kind === 'folder') {
      return this.getFolderChildren(element);
    }

    return [];
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Reload everything from the API. */
  async refresh(): Promise<void> {
    this.api.clearCache();
    await this.loadRepositories();
  }

  /** Initial load of repositories. */
  async loadRepositories(): Promise<void> {
    this.isLoading = true;
    this._onDidChangeTreeData.fire();

    try {
      this.repositories = await this.getWorkspaceGitHubRepos();
      Logger.info(`Loaded ${this.repositories.length} repositories`);
      
      // Re-bind to git events to ensure we are listening to any new/removed repositories
      this.bindGitEvents();
    } catch (err) {
      Logger.error('Failed to load repositories', err);
      this.repositories = [];
      vscode.window.showErrorMessage(
        `GitHub PR Viewer: Failed to load workspace repositories. ${err}`,
      );
    } finally {
      this.isLoading = false;
      this._onDidChangeTreeData.fire();
    }
  }

  // -----------------------------------------------------------------------
  // Git Integration
  // -----------------------------------------------------------------------

  /** Bind listeners to VS Code Git extension events for live updates */
  private bindGitEvents(): void {
    // Clean up old listeners
    this.gitDisposables.forEach((d) => d.dispose());
    this.gitDisposables = [];

    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
      return;
    }

    try {
      const gitApi = gitExtension.exports.getAPI(1);

      // Listen to repository open/close events
      this.gitDisposables.push(
        gitApi.onDidOpenRepository(() => this.refresh()),
        gitApi.onDidCloseRepository(() => this.refresh()),
      );

      // Listen to repository state changes (e.g. branch switch, commits)
      for (const repo of gitApi.repositories) {
        this.gitDisposables.push(
          repo.state.onDidChange(() => {
            Logger.info(`Git state changed for ${repo.rootUri.fsPath}, refreshing tree`);
            this.refresh();
          }),
        );
      }
    } catch (err) {
      Logger.error('Failed to bind Git events', err);
    }
  }

  /** Get list of all GitHub repositories in current workspace */
  private async getWorkspaceGitHubRepos(): Promise<LocalRepo[]> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
      Logger.warn('Git extension not found');
      return [];
    }

    if (!gitExtension.isActive) {
      await gitExtension.activate();
    }

    const gitApi = gitExtension.exports.getAPI(1);
    const repos = gitApi.repositories;
    const githubRepos: LocalRepo[] = [];

    for (const repo of repos) {
      for (const remote of repo.state.remotes) {
        const url = remote.fetchUrl || remote.pushUrl;
        if (url) {
          const parsed = parseGitRemoteUrl(url);
          if (parsed) {
            githubRepos.push({
              owner: parsed.owner,
              name: parsed.repo,
              uri: repo.rootUri,
            });
            break; // Match first valid github remote
          }
        }
      }
    }

    return githubRepos;
  }

  // -----------------------------------------------------------------------
  // Private helpers – tree building
  // -----------------------------------------------------------------------

  private async getRootChildren(): Promise<TreeNode[]> {
    if (this.isLoading) {
      return [{ kind: 'message', text: '$(loading~spin) Detecting repositories…' }];
    }

    if (this.repositories.length === 0) {
      return [
        {
          kind: 'message',
          text: 'No Git repository found',
          tooltip: 'Make sure your open folder has a Git repository with a GitHub remote.',
        },
      ];
    }

    return this.repositories.map((repo) => ({ kind: 'repo', repo }));
  }

  private async getFolderChildren(folder: FolderNode): Promise<TreeNode[]> {
    try {
      const prs = await this.api.getPRsForRepo(
        folder.repo.owner,
        folder.repo.name,
        folder.state,
      );

      if (prs.length === 0) {
        return [
          {
            kind: 'message',
            text: `No ${folder.state} pull requests`,
            tooltip: `No ${folder.state} PRs created by you in ${folder.repo.owner}/${folder.repo.name}.`,
          },
        ];
      }

      return prs.map((pr) => ({
        kind: 'pr',
        pr,
      }));
    } catch (err) {
      Logger.error(`Failed to load PRs for ${folder.repo.owner}/${folder.repo.name}`, err);
      return [
        {
          kind: 'message',
          text: `$(error) Error loading PRs`,
          tooltip: String(err),
        },
      ];
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers – tree item creation
  // -----------------------------------------------------------------------

  private createRepoItem(repo: LocalRepo): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${repo.owner}/${repo.name}`,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.iconPath = new vscode.ThemeIcon('repo');
    item.tooltip = `${repo.owner}/${repo.name} (Local Workspace)`;
    item.contextValue = 'repo';
    return item;
  }

  private createFolderItem(repo: LocalRepo, label: string, state: 'open' | 'closed'): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
    if (state === 'open') {
      item.iconPath = new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.green'));
    } else {
      item.iconPath = new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('charts.red'));
    }
    item.contextValue = `folder-${state}`;
    return item;
  }

  private createPRItem(pr: PR): vscode.TreeItem {
    const label = `#${pr.number} ${pr.title}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    // Description (shown to the right of the label)
    item.description = this.getPRStateLabel(pr);

    // Icon with color
    item.iconPath = this.getPRIcon(pr);

    // Tooltip
    const repo = this.extractRepoName(pr.html_url);
    item.tooltip = new vscode.MarkdownString(
      `**${pr.title}** (#${pr.number})\n\n` +
        `**Repo:** ${repo}\n\n` +
        `**Author:** @${pr.user.login}\n\n` +
        `**State:** ${this.getPRStateLabel(pr)}\n\n` +
        `**Created:** ${new Date(pr.created_at).toLocaleDateString()}\n\n` +
        (pr.draft ? '📝 *Draft*\n\n' : '') +
        (pr.labels.length > 0
          ? `**Labels:** ${pr.labels.map((l) => l.name).join(', ')}`
          : ''),
    );

    // Click → show details
    item.command = {
      command: 'github-pr-viewer.showPRDetails',
      title: 'Show PR Details',
      arguments: [pr],
    };

    item.contextValue = 'pr';
    return item;
  }

  private createMessageItem(text: string, tooltip?: string): vscode.TreeItem {
    const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
    item.tooltip = tooltip;
    return item;
  }

  // -----------------------------------------------------------------------
  // Private helpers – PR display
  // -----------------------------------------------------------------------

  private getPRStateLabel(pr: PR): string {
    if (pr.state === 'open') {
      return pr.draft ? '📝 Draft' : '🟢 Open';
    }
    return pr.merged_at ? '🟣 Merged' : '🔴 Closed';
  }

  private getPRIcon(pr: PR): vscode.ThemeIcon {
    if (pr.state === 'open') {
      if (pr.draft) {
        return new vscode.ThemeIcon(
          'git-pull-request-draft',
          new vscode.ThemeColor('charts.gray'),
        );
      }
      return new vscode.ThemeIcon(
        'git-pull-request',
        new vscode.ThemeColor('charts.green'),
      );
    }
    if (pr.merged_at) {
      return new vscode.ThemeIcon(
        'git-merge',
        new vscode.ThemeColor('charts.purple'),
      );
    }
    return new vscode.ThemeIcon(
      'git-pull-request-closed',
      new vscode.ThemeColor('charts.red'),
    );
  }

  private extractRepoName(htmlUrl: string): string {
    const parts = htmlUrl.split('/');
    return `${parts[3]}/${parts[4]}`;
  }
}
