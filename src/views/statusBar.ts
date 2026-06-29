import * as vscode from 'vscode';

/**
 * Status bar item showing authentication state and a quick PR count.
 *
 * Clicking it triggers the refresh command.
 */
export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.item.command = 'github-pr-viewer.refresh';
    this.showLoading();
    this.item.show();
  }

  /** Show a loading indicator. */
  showLoading(): void {
    this.item.text = '$(loading~spin) GitHub PRs';
    this.item.tooltip = 'Loading pull requests…';
  }

  /** Show the authenticated state with an optional PR count. */
  showAuthenticated(username: string, prCount?: number): void {
    const count = prCount !== undefined ? ` (${prCount})` : '';
    this.item.text = `$(git-pull-request) PRs${count}`;
    this.item.tooltip = `GitHub PR Viewer — signed in as @${username}\nClick to refresh`;
  }

  /** Show unauthenticated state. */
  showUnauthenticated(): void {
    this.item.text = '$(sign-in) GitHub PRs';
    this.item.tooltip = 'Click to sign in to GitHub';
    this.item.command = 'github-pr-viewer.authenticate';
  }

  /** Show an error state. */
  showError(message: string): void {
    this.item.text = '$(error) GitHub PRs';
    this.item.tooltip = `Error: ${message}`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
