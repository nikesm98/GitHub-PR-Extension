import * as vscode from 'vscode';
import type { PR } from '../github/types';
import type { GitHubAPI } from '../github/api';
import { Logger } from '../utils/logger';

/**
 * Webview panel for displaying rich PR details.
 *
 * Uses a singleton pattern — clicking a PR re-uses the existing panel
 * instead of opening many tabs. Content Security Policy is enforced.
 */
export class PRDetailPanel {
  private static currentPanel: PRDetailPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  // -----------------------------------------------------------------------
  // Public static API
  // -----------------------------------------------------------------------

  /**
   * Show (or re-use) a detail panel for the given PR.
   *
   * For PRs from the list endpoint we fetch full details (with stats)
   * via the API, then render.
   */
  static async show(
    pr: PR,
    api: GitHubAPI,
  ): Promise<void> {
    // Try to fetch full PR details (the list endpoint doesn't include stats)
    let fullPR = pr;
    try {
      const parts = pr.html_url.split('/');
      // parts is e.g. ['https:', '', 'github.com', 'owner', 'repo', 'pull', 'number']
      parts.pop(); // remove number
      parts.pop(); // remove 'pull'
      const repoName = parts.pop() ?? '';
      const ownerName = parts.pop() ?? '';
      fullPR = await api.getPRDetails(ownerName, repoName, pr.number);
    } catch (err) {
      Logger.warn(`Could not fetch full PR details for ${pr.html_url} #${pr.number}, using list data`, err);
    }

    if (PRDetailPanel.currentPanel) {
      PRDetailPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      PRDetailPanel.currentPanel.update(fullPR);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'prDetail',
      `PR #${pr.number}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: false,
        localResourceRoots: [],
      },
    );

    PRDetailPanel.currentPanel = new PRDetailPanel(panel, fullPR);
  }

  // -----------------------------------------------------------------------
  // Instance
  // -----------------------------------------------------------------------

  private constructor(panel: vscode.WebviewPanel, pr: PR) {
    this.panel = panel;
    this.update(pr);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private update(pr: PR): void {
    this.panel.title = `PR #${pr.number}`;
    this.panel.webview.html = PRDetailPanel.getHtml(pr);
  }

  private dispose(): void {
    PRDetailPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  // -----------------------------------------------------------------------
  // HTML Rendering
  // -----------------------------------------------------------------------

  private static getHtml(pr: PR): string {
    const esc = PRDetailPanel.escapeHtml;
    const parts = pr.html_url.split('/');
    const repo = `${parts[3]}/${parts[4]}`;
    const created = new Date(pr.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const merged = pr.merged_at
      ? new Date(pr.merged_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : null;

    const stateClass = pr.merged_at
      ? 'merged'
      : pr.state === 'open'
        ? 'open'
        : 'closed';
    const stateLabel = pr.merged_at
      ? 'Merged'
      : pr.state === 'open'
        ? pr.draft
          ? 'Draft'
          : 'Open'
        : 'Closed';

    const labelsHtml = pr.labels
      .map(
        (l) =>
          `<span class="label" style="background:#${esc(l.color)}30;color:#${esc(l.color)};border:1px solid #${esc(l.color)}50">${esc(l.name)}</span>`,
      )
      .join(' ');

    const reviewersHtml = pr.requested_reviewers
      .map((r) => `<span class="reviewer">@${esc(r.login)}</span>`)
      .join(' ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PR #${pr.number}</title>
  <style>
    :root {
      --radius: 6px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                   'Helvetica Neue', Arial, sans-serif;
      padding: 24px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      line-height: 1.5;
    }

    /* ---- Header ---- */
    .header {
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.3;
      margin-bottom: 12px;
      word-wrap: break-word;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge.open { background: #238636; color: #fff; }
    .badge.merged { background: #8957e5; color: #fff; }
    .badge.closed { background: #da3633; color: #fff; }
    .badge.draft { background: #6e7681; color: #fff; }

    /* ---- Meta grid ---- */
    .meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 24px;
      margin-top: 16px;
      font-size: 13px;
    }
    .meta-label {
      font-weight: 600;
      opacity: 0.7;
    }

    /* ---- Sections ---- */
    .section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      opacity: 0.6;
      margin-top: 28px;
      margin-bottom: 10px;
    }

    /* ---- Stats ---- */
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .stat {
      background: var(--vscode-editor-lineHighlightBackground, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: var(--radius);
      padding: 14px 10px;
      text-align: center;
    }
    .stat-value {
      font-size: 22px;
      font-weight: 700;
    }
    .stat-value.add { color: #3fb950; }
    .stat-value.del { color: #f85149; }
    .stat-value.files { color: #79c0ff; }
    .stat-value.commits { color: #d2a8ff; }
    .stat-label {
      font-size: 11px;
      opacity: 0.6;
      margin-top: 4px;
    }

    /* ---- Branches ---- */
    .branches {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      background: var(--vscode-editor-lineHighlightBackground, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: var(--radius);
      padding: 10px 14px;
      font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    }
    .branch-name {
      background: var(--vscode-badge-background, #333);
      color: var(--vscode-badge-foreground, #fff);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    .branch-arrow { opacity: 0.5; }

    /* ---- Labels ---- */
    .labels { display: flex; flex-wrap: wrap; gap: 6px; }
    .label {
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }

    /* ---- Reviewers ---- */
    .reviewers { display: flex; flex-wrap: wrap; gap: 6px; }
    .reviewer {
      background: var(--vscode-editor-lineHighlightBackground, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, #333);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
    }

    /* ---- Description ---- */
    .description {
      background: var(--vscode-editor-lineHighlightBackground, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: var(--radius);
      padding: 16px;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-size: 13px;
      line-height: 1.7;
      max-height: 400px;
      overflow-y: auto;
    }

    /* ---- Button ---- */
    .actions { margin-top: 28px; }
    .btn {
      display: inline-block;
      padding: 8px 18px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      text-decoration: none;
      border-radius: var(--radius);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: background 0.15s ease;
    }
    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    /* ---- Responsive ---- */
    @media (max-width: 500px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
      .meta { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="title">${esc(pr.title)}</div>
    <span class="badge ${pr.draft ? 'draft' : stateClass}">${stateLabel}</span>
    <div class="meta">
      <div><span class="meta-label">Repository</span><br>${esc(repo)}</div>
      <div><span class="meta-label">Author</span><br>@${esc(pr.user.login)}</div>
      <div><span class="meta-label">Created</span><br>${created}</div>
      <div><span class="meta-label">${merged ? 'Merged' : 'Updated'}</span><br>${merged ?? new Date(pr.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
    </div>
  </div>

  <div class="section-title">Branches</div>
  <div class="branches">
    <span class="branch-name">${esc(pr.head.ref)}</span>
    <span class="branch-arrow">→</span>
    <span class="branch-name">${esc(pr.base.ref)}</span>
  </div>

  <div class="section-title">Statistics</div>
  <div class="stats">
    <div class="stat">
      <div class="stat-value add">+${pr.additions.toLocaleString()}</div>
      <div class="stat-label">additions</div>
    </div>
    <div class="stat">
      <div class="stat-value del">-${pr.deletions.toLocaleString()}</div>
      <div class="stat-label">deletions</div>
    </div>
    <div class="stat">
      <div class="stat-value files">${pr.changed_files.toLocaleString()}</div>
      <div class="stat-label">files changed</div>
    </div>
    <div class="stat">
      <div class="stat-value commits">${pr.commits.toLocaleString()}</div>
      <div class="stat-label">commits</div>
    </div>
  </div>

  ${
    pr.labels.length > 0
      ? `<div class="section-title">Labels</div><div class="labels">${labelsHtml}</div>`
      : ''
  }

  ${
    pr.requested_reviewers.length > 0
      ? `<div class="section-title">Reviewers</div><div class="reviewers">${reviewersHtml}</div>`
      : ''
  }

  <div class="section-title">Description</div>
  <div class="description">${esc(pr.body || 'No description provided.')}</div>

  <div class="actions">
    <a href="${esc(pr.html_url)}" class="btn">Open on GitHub →</a>
  </div>

</body>
</html>`;
  }

  // -----------------------------------------------------------------------

  private static escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (c) => map[c]);
  }
}
