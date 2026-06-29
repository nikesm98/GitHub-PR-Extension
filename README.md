# GitHub PR Viewer

> View your GitHub Pull Requests from any organization directly in VS Code — with status tracking, rich details, and zero configuration.

## Features

- **🔐 Seamless Authentication** — Sign in with GitHub via VS Code's built-in auth (1 click!) or use a Personal Access Token
- **🏢 Organization View** — See all your organizations in the sidebar
- **📋 PR Listing** — View your PRs across all repos in each org
- **🎯 Rich Details Panel** — PR title, description, branch info, stats (additions/deletions/files/commits), labels, and reviewers
- **🔄 Auto-Refresh** — Optionally auto-refresh at configurable intervals
- **🔍 State Filtering** — Filter by Open, Closed, or All PRs
- **⚡ Fast & Cached** — In-memory caching with configurable TTL to minimize API calls
- **📊 Status Bar** — Quick glance at auth status and PR count
- **🏷️ Draft PR Support** — Clearly identify draft PRs
- **🔒 Secure** — Tokens stored in VS Code's encrypted secret storage, never logged

## Getting Started

### Quick Start (30 seconds)

1. Install the extension
2. Click the **GitHub PRs** icon in the activity bar (left sidebar)
3. Click **"Sign in with GitHub"**
4. Authorize in the browser popup
5. Your organizations and PRs appear! 🎉

### Alternative: Personal Access Token

If VS Code's built-in auth isn't available:

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Create a token with scopes: `repo`, `read:user`, `read:org`, `user:email`
3. In VS Code, run command: **GitHub PR Viewer: Sign in with Personal Access Token**
4. Paste your token

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `github-pr-viewer.companyDomains` | `[]` | Company email domains to verify (leave empty to skip) |
| `github-pr-viewer.cacheTTL` | `300` | Cache duration in seconds |
| `github-pr-viewer.autoRefresh` | `false` | Enable auto-refresh |
| `github-pr-viewer.autoRefreshInterval` | `300` | Auto-refresh interval (seconds) |
| `github-pr-viewer.defaultPRState` | `open` | Default PR filter: `open`, `closed`, or `all` |
| `github-pr-viewer.maxReposPerOrg` | `100` | Max repos to scan per organization |

## Commands

| Command | Description |
|---------|-------------|
| `GitHub PR Viewer: Sign in with GitHub` | Sign in via VS Code's built-in auth |
| `GitHub PR Viewer: Sign in with Personal Access Token` | Sign in with a PAT |
| `GitHub PR Viewer: Refresh PR List` | Refresh all data |
| `GitHub PR Viewer: Sign Out` | Clear stored credentials |
| `GitHub PR Viewer: Filter PRs by State` | Quick-pick to filter Open/Closed/All |

## Privacy & Security

- **No telemetry** — This extension does not collect any usage data
- **Encrypted storage** — Tokens stored in VS Code's system credential store
- **Minimal scopes** — Only requests the permissions needed
- **No server** — All API calls go directly from your machine to GitHub
- **Open source** — Full source code available for audit

## Requirements

- VS Code 1.85.0 or later
- A GitHub account with organization membership

## License

MIT
