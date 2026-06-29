import * as vscode from 'vscode';
import { GitHubAuth } from './github/auth';
import { GitHubAPI } from './github/api';
import { PRTreeProvider } from './views/prTreeView';
import { PRDetailPanel } from './views/prDetailPanel';
import { StatusBar } from './views/statusBar';
import { CompanyEmailValidator } from './utils/validators';
import { Logger } from './utils/logger';
import type { PR, PRState } from './github/types';

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

let auth: GitHubAuth;
let api: GitHubAPI | undefined;
let treeProvider: PRTreeProvider | undefined;
let statusBar: StatusBar | undefined;
let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  Logger.init();
  Logger.info('GitHub PR Viewer extension activating');

  auth = new GitHubAuth(context);
  statusBar = new StatusBar();
  context.subscriptions.push({ dispose: () => statusBar?.dispose() });

  // Register commands (always available, even before auth)
  registerCommands(context);

  // Try silent authentication on startup
  try {
    const token = await auth.getToken();
    if (token) {
      await initializeWithToken(context, token);
    } else {
      statusBar.showUnauthenticated();
      Logger.info('No stored credentials — waiting for sign-in');
    }
  } catch (err) {
    Logger.error('Startup auth check failed', err);
    statusBar?.showUnauthenticated();
  }

  // Listen for VS Code auth session changes (user signs in/out via accounts menu)
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions(async (e) => {
      if (e.provider.id === 'github') {
        Logger.info('GitHub auth session changed, re-initializing');
        const token = await auth.getToken();
        if (token) {
          await initializeWithToken(context, token);
        } else {
          handleSignOut();
        }
      }
    }),
  );

  Logger.info('GitHub PR Viewer extension activated');
}

export function deactivate(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  Logger.info('GitHub PR Viewer extension deactivated');
  Logger.dispose();
}

// ---------------------------------------------------------------------------
// Initialization after auth
// ---------------------------------------------------------------------------

async function initializeWithToken(
  context: vscode.ExtensionContext,
  token: string,
): Promise<void> {
  api = new GitHubAPI(token);

  // Company email validation (optional)
  try {
    const validator = new CompanyEmailValidator();
    const result = await validator.validate(token);

    if (!result.isCompanyEmail && result.email) {
      const action = await vscode.window.showWarningMessage(
        `GitHub PR Viewer: Email "${result.email}" is not from a configured company domain. Continue?`,
        'Yes, continue',
        'Configure domains',
      );

      if (action === 'Configure domains') {
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'github-pr-viewer.companyDomains',
        );
        return;
      }
      if (action !== 'Yes, continue') {
        statusBar?.showUnauthenticated();
        return;
      }
    }

    if (result.email) {
      Logger.info(`Authenticated as ${result.email}`);
    }
  } catch (err) {
    // Email validation is non-critical — log and continue
    Logger.warn('Email validation failed (non-critical)', err);
  }

  // Initialize tree view
  treeProvider = new PRTreeProvider(api);
  const treeView = vscode.window.createTreeView('github-pr-viewer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Load data
  await treeProvider.loadRepositories();

  // Update status bar
  try {
    const username = await api.getUsername();
    statusBar?.showAuthenticated(username);
  } catch {
    statusBar?.showAuthenticated('user');
  }

  // Set up auto-refresh
  setupAutoRefresh();

  // Watch settings changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('github-pr-viewer')) {
        Logger.info('Settings changed, applying updates');
        setupAutoRefresh();

        // If cache TTL or PR state changed, refresh data
        if (
          e.affectsConfiguration('github-pr-viewer.cacheTTL') ||
          e.affectsConfiguration('github-pr-viewer.defaultPRState')
        ) {
          treeProvider?.refresh();
        }
      }
    }),
  );

  // Set context for conditional UI
  vscode.commands.executeCommand(
    'setContext',
    'github-pr-viewer.authenticated',
    true,
  );
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    // Sign in with VS Code built-in auth
    vscode.commands.registerCommand('github-pr-viewer.authenticate', async () => {
      try {
        statusBar?.showLoading();
        const token = await auth.signIn();
        await initializeWithToken(context, token);
        vscode.window.showInformationMessage(
          'GitHub PR Viewer: Signed in successfully! ✅',
        );
      } catch (err) {
        Logger.error('Sign-in failed', err);
        statusBar?.showError('Sign-in failed');
        vscode.window.showErrorMessage(
          `GitHub PR Viewer: Sign-in failed. ${err}`,
        );
      }
    }),

    // Sign in with PAT
    vscode.commands.registerCommand(
      'github-pr-viewer.authenticatePAT',
      async () => {
        try {
          statusBar?.showLoading();
          const token = await auth.signInWithPAT();
          await initializeWithToken(context, token);
          vscode.window.showInformationMessage(
            'GitHub PR Viewer: Signed in with PAT! ✅',
          );
        } catch (err) {
          Logger.error('PAT sign-in failed', err);
          statusBar?.showError('Sign-in failed');
          vscode.window.showErrorMessage(
            `GitHub PR Viewer: PAT sign-in failed. ${err}`,
          );
        }
      },
    ),

    // Refresh
    vscode.commands.registerCommand('github-pr-viewer.refresh', async () => {
      if (!treeProvider || !api) {
        vscode.window.showWarningMessage(
          'GitHub PR Viewer: Sign in first to refresh.',
        );
        return;
      }

      statusBar?.showLoading();
      await treeProvider.refresh();

      try {
        const username = await api.getUsername();
        statusBar?.showAuthenticated(username);
      } catch {
        statusBar?.showAuthenticated('user');
      }

      vscode.window.showInformationMessage('GitHub PR Viewer: Refreshed! 🔄');
    }),

    // Logout
    vscode.commands.registerCommand('github-pr-viewer.logout', async () => {
      await auth.signOut();
      handleSignOut();
    }),

    // Show PR details
    vscode.commands.registerCommand(
      'github-pr-viewer.showPRDetails',
      async (pr: PR) => {
        if (!api) {
          return;
        }
        await PRDetailPanel.show(pr, api);
      },
    ),

    // Open on GitHub
    vscode.commands.registerCommand(
      'github-pr-viewer.openOnGitHub',
      (pr: PR) => {
        if (pr?.html_url) {
          vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
        }
      },
    ),

    // Filter by state
    vscode.commands.registerCommand(
      'github-pr-viewer.filterByState',
      async () => {
        const options: Array<{ label: string; value: PRState }> = [
          { label: '🟢 Open PRs', value: 'open' },
          { label: '🔴 Closed PRs', value: 'closed' },
          { label: '📋 All PRs', value: 'all' },
        ];

        const selected = await vscode.window.showQuickPick(options, {
          placeHolder: 'Filter pull requests by state',
        });

        if (selected) {
          const config = vscode.workspace.getConfiguration('github-pr-viewer');
          await config.update(
            'defaultPRState',
            selected.value,
            vscode.ConfigurationTarget.Global,
          );
          treeProvider?.refresh();
        }
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleSignOut(): void {
  api = undefined;
  treeProvider = undefined;
  statusBar?.showUnauthenticated();

  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = undefined;
  }

  vscode.commands.executeCommand(
    'setContext',
    'github-pr-viewer.authenticated',
    false,
  );
}

function setupAutoRefresh(): void {
  // Clear existing timer
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = undefined;
  }

  const config = vscode.workspace.getConfiguration('github-pr-viewer');
  const enabled = config.get<boolean>('autoRefresh', false);

  if (!enabled || !treeProvider) {
    return;
  }

  const intervalSec = config.get<number>('autoRefreshInterval', 300);
  Logger.info(`Auto-refresh enabled every ${intervalSec}s`);

  autoRefreshTimer = setInterval(() => {
    Logger.info('Auto-refreshing PR list');
    treeProvider?.refresh();
  }, intervalSec * 1000);
}
