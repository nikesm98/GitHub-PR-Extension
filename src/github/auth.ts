import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

/**
 * Authentication handler supporting two strategies:
 *
 * 1. **VS Code Built-in GitHub Auth** (primary)
 *    Uses `vscode.authentication.getSession('github', ...)` — zero config,
 *    automatic token refresh, and the standard VS Code accounts flow.
 *
 * 2. **Manual Personal Access Token** (fallback)
 *    For environments where the built-in auth provider is unavailable
 *    (e.g., older VS Code, VSCodium, remote containers).
 *    Tokens are stored in VS Code's encrypted secret storage.
 */
export class GitHubAuth {
  private static readonly SECRET_KEY = 'github-pr-viewer.pat';
  private static readonly GITHUB_SCOPES = ['repo', 'read:user', 'read:org', 'user:email'];

  constructor(private readonly context: vscode.ExtensionContext) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Attempt to get a valid token.
   * Tries VS Code built-in auth first, then falls back to stored PAT.
   * Does NOT prompt the user — call `signIn()` or `signInWithPAT()` for that.
   */
  async getToken(): Promise<string | undefined> {
    // 1. Try built-in GitHub auth (silent — no prompt)
    try {
      const session = await vscode.authentication.getSession(
        'github',
        GitHubAuth.GITHUB_SCOPES,
        { silent: true },
      );
      if (session) {
        Logger.info('Authenticated via VS Code built-in GitHub auth');
        return session.accessToken;
      }
    } catch (err) {
      Logger.debug('Built-in auth silent check failed', err);
    }

    // 2. Try stored PAT
    const pat = await this.context.secrets.get(GitHubAuth.SECRET_KEY);
    if (pat) {
      const valid = await this.validateToken(pat);
      if (valid) {
        Logger.info('Authenticated via stored PAT');
        return pat;
      }
      // Token expired/revoked — remove it
      await this.context.secrets.delete(GitHubAuth.SECRET_KEY);
      Logger.warn('Stored PAT is invalid — removed');
    }

    return undefined;
  }

  /**
   * Interactive sign-in via VS Code's built-in GitHub auth.
   * Shows the standard "Sign in with GitHub" dialog.
   */
  async signIn(): Promise<string> {
    Logger.info('Starting VS Code built-in GitHub sign-in');

    const session = await vscode.authentication.getSession(
      'github',
      GitHubAuth.GITHUB_SCOPES,
      { createIfNone: true },
    );

    if (!session) {
      throw new Error('GitHub sign-in was cancelled');
    }

    Logger.info(`Signed in as GitHub user via built-in auth`);
    return session.accessToken;
  }

  /**
   * Interactive sign-in via manual PAT entry.
   */
  async signInWithPAT(): Promise<string> {
    Logger.info('Starting manual PAT sign-in');

    const token = await vscode.window.showInputBox({
      title: 'GitHub Personal Access Token',
      prompt:
        'Paste a GitHub PAT with scopes: repo, read:user, read:org, user:email',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'ghp_...',
      validateInput: (value) => {
        if (!value?.trim()) {
          return 'Token cannot be empty';
        }
        // GitHub PATs start with ghp_ (classic) or github_pat_ (fine-grained)
        if (
          !value.trim().startsWith('ghp_') &&
          !value.trim().startsWith('github_pat_')
        ) {
          return 'Token should start with ghp_ or github_pat_';
        }
        return undefined;
      },
    });

    if (!token) {
      throw new Error('PAT entry was cancelled');
    }

    const trimmed = token.trim();
    const valid = await this.validateToken(trimmed);
    if (!valid) {
      throw new Error(
        'Invalid or expired token. Please generate a new one at https://github.com/settings/tokens',
      );
    }

    await this.context.secrets.store(GitHubAuth.SECRET_KEY, trimmed);
    Logger.info('PAT stored securely');
    return trimmed;
  }

  /**
   * Sign out — clears stored PAT.
   * VS Code built-in sessions are managed by VS Code itself.
   */
  async signOut(): Promise<void> {
    await this.context.secrets.delete(GitHubAuth.SECRET_KEY);
    Logger.info('Signed out (PAT cleared)');
    vscode.window.showInformationMessage('GitHub PR Viewer: Signed out');
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async validateToken(token: string): Promise<boolean> {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'github-pr-viewer-vscode',
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
