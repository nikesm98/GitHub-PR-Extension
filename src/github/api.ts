import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import { Logger } from '../utils/logger';
import type {
  CacheEntry,
  Organization,
  PR,
  PRState,
  Repository,
} from './types';

/**
 * GitHub REST API client.
 *
 * Production-grade features:
 * - Uses `@octokit/rest` for automatic pagination & typed responses
 * - In-memory cache with configurable TTL from VS Code settings
 * - Concurrent repo fetching via `Promise.allSettled`
 * - Rate-limit awareness
 * - Cached username to avoid redundant `/user` calls
 */
export class GitHubAPI {
  private octokit: Octokit;
  private cache = new Map<string, CacheEntry<unknown>>();
  private currentUsername: string | undefined;

  constructor(token: string) {
    this.octokit = new Octokit({
      auth: token,
      userAgent: 'github-pr-viewer-vscode',
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Get all organizations the authenticated user belongs to. */
  async getOrganizations(): Promise<Organization[]> {
    return this.cached('orgs', async () => {
      Logger.info('Fetching organizations');
      const orgs = await this.octokit.paginate(
        this.octokit.rest.orgs.listForAuthenticatedUser,
        { per_page: 100 },
      );
      Logger.info(`Found ${orgs.length} organizations`);
      return orgs.map((o) => ({
        login: o.login,
        description: o.description ?? null,
        avatar_url: o.avatar_url,
      }));
    });
  }

  /**
   * Get the authenticated user's PRs across all repos in an organization.
   *
   * @param orgName  GitHub org login name
   * @param state    Filter: 'open' | 'closed' | 'all' (defaults to settings)
   */
  async getPRsForOrganization(
    orgName: string,
    state?: PRState,
  ): Promise<PR[]> {
    const effectiveState = state ?? this.getDefaultPRState();
    const cacheKey = `prs:${orgName}:${effectiveState}`;

    return this.cached(cacheKey, async () => {
      const username = await this.getUsername();
      Logger.info(
        `Fetching ${effectiveState} PRs for @${username} in ${orgName}`,
      );

      // Get repos (paginated, skips archived & forks)
      const repos = await this.getOrgRepos(orgName);
      Logger.info(`Scanning ${repos.length} repos in ${orgName}`);

      // Fetch PRs from all repos concurrently
      const results = await Promise.allSettled(
        repos.map((repo) =>
          this.getPRsForRepoWithCreator(orgName, repo.name, username, effectiveState),
        ),
      );

      const allPRs: PR[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allPRs.push(...result.value);
        } else {
          Logger.warn(`Failed to fetch PRs from a repo: ${result.reason}`);
        }
      }

      // Sort newest first
      allPRs.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      Logger.info(`Found ${allPRs.length} PRs in ${orgName}`);
      return allPRs;
    });
  }

  /**
   * Get the authenticated user's PRs for a specific repository.
   *
   * @param owner  Repository owner
   * @param repo   Repository name
   * @param state  Filter: 'open' | 'closed' | 'all'
   */
  async getPRsForRepo(
    owner: string,
    repo: string,
    state: PRState,
  ): Promise<PR[]> {
    const username = await this.getUsername();
    const cacheKey = `prs:${owner}/${repo}:${state}:${username}`;

    return this.cached(cacheKey, async () => {
      Logger.info(
        `Fetching ${state} PRs for @${username} in ${owner}/${repo}`,
      );
      try {
        const prs = await this.octokit.paginate(
          this.octokit.rest.pulls.list,
          {
            owner,
            repo,
            state: state === 'all' ? 'all' : state,
            per_page: 50,
          },
        );

        // Filter by creator (the user) and map to internal PR format
        return prs
          .filter((pr) => pr.user?.login === username)
          .map((pr) => this.mapPR(pr));
      } catch (err) {
        Logger.error(`Failed to fetch PRs for ${owner}/${repo}`, err);
        return [];
      }
    });
  }

  /**
   * Get detailed PR information (additions, deletions, etc.)
   * The list endpoint doesn't return stats — we need to fetch each PR individually.
   */
  async getPRDetails(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<PR> {
    const cacheKey = `pr-detail:${owner}/${repo}#${pullNumber}`;

    return this.cached(cacheKey, async () => {
      Logger.info(`Fetching PR details: ${owner}/${repo}#${pullNumber}`);
      const { data } = await this.octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });
      return this.mapPR(data);
    });
  }

  /** Get the authenticated user's GitHub login. */
  async getUsername(): Promise<string> {
    if (this.currentUsername) {
      return this.currentUsername;
    }
    const { data } = await this.octokit.rest.users.getAuthenticated();
    this.currentUsername = data.login;
    return data.login;
  }

  /** Get the authenticated user's primary email. */
  async getUserEmail(): Promise<string> {
    const { data } =
      await this.octokit.rest.users.listEmailsForAuthenticatedUser();
    const primary = data.find((e) => e.primary);
    return primary?.email ?? '';
  }

  /** Check remaining rate limit. */
  async getRateLimit(): Promise<{ remaining: number; limit: number; reset: Date }> {
    const { data } = await this.octokit.rest.rateLimit.get();
    return {
      remaining: data.rate.remaining,
      limit: data.rate.limit,
      reset: new Date(data.rate.reset * 1000),
    };
  }

  /** Clear all cached data. */
  clearCache(): void {
    this.cache.clear();
    this.currentUsername = undefined;
    Logger.info('Cache cleared');
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async getOrgRepos(orgName: string): Promise<Repository[]> {
    const maxRepos = this.getMaxReposPerOrg();

    const repos = await this.octokit.paginate(
      this.octokit.rest.repos.listForOrg,
      { org: orgName, per_page: 100, type: 'all', sort: 'pushed' },
    );

    return repos
      .filter((r) => !r.archived && !r.fork)
      .slice(0, maxRepos)
      .map((r) => ({
        name: r.name,
        full_name: r.full_name,
        html_url: r.html_url,
        description: r.description ?? null,
        private: r.private,
        archived: r.archived ?? false,
        fork: r.fork,
      }));
  }

  private async getPRsForRepoWithCreator(
    owner: string,
    repo: string,
    creator: string,
    state: PRState,
  ): Promise<PR[]> {
    try {
      const prs = await this.octokit.paginate(
        this.octokit.rest.pulls.list,
        {
          owner,
          repo,
          state: state === 'all' ? 'all' : state,
          per_page: 50,
        },
      );

      // Filter by creator (the API's `creator` parameter is not available
      // on all paginated calls so we filter client-side)
      return prs
        .filter((pr) => pr.user?.login === creator)
        .map(this.mapPR);
    } catch {
      // Repo might be inaccessible (permissions) — skip silently
      return [];
    }
  }

  private mapPR(data: Record<string, unknown> | any): PR {
    return {
      id: data.id,
      number: data.number,
      title: data.title,
      state: data.state as 'open' | 'closed',
      merged_at: data.merged_at ?? null,
      user: {
        login: data.user?.login ?? 'unknown',
        avatar_url: data.user?.avatar_url ?? '',
        html_url: data.user?.html_url ?? '',
      },
      repository_url: data.repository_url ?? '',
      html_url: data.html_url ?? '',
      body: data.body ?? null,
      additions: data.additions ?? 0,
      deletions: data.deletions ?? 0,
      changed_files: data.changed_files ?? 0,
      commits: data.commits ?? 0,
      created_at: data.created_at,
      updated_at: data.updated_at,
      draft: data.draft ?? false,
      labels: (data.labels ?? []).map((l: any) => ({
        id: l.id,
        name: l.name,
        color: l.color,
        description: l.description ?? null,
      })),
      head: {
        ref: data.head?.ref ?? '',
        sha: data.head?.sha ?? '',
      },
      base: {
        ref: data.base?.ref ?? '',
        sha: data.base?.sha ?? '',
      },
      requested_reviewers: (data.requested_reviewers ?? []).map((u: any) => ({
        login: u.login,
        avatar_url: u.avatar_url ?? '',
        html_url: u.html_url ?? '',
      })),
    };
  }

  // -----------------------------------------------------------------------
  // Cache
  // -----------------------------------------------------------------------

  private async cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    const ttl = this.getCacheTTL();

    if (entry && Date.now() - entry.timestamp < ttl) {
      Logger.debug(`Cache hit: ${key}`);
      return entry.data;
    }

    const data = await fetcher();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  // -----------------------------------------------------------------------
  // Settings helpers
  // -----------------------------------------------------------------------

  private getCacheTTL(): number {
    const config = vscode.workspace.getConfiguration('github-pr-viewer');
    const seconds = config.get<number>('cacheTTL', 300);
    return seconds * 1000;
  }

  private getDefaultPRState(): PRState {
    const config = vscode.workspace.getConfiguration('github-pr-viewer');
    return config.get<PRState>('defaultPRState', 'open');
  }

  private getMaxReposPerOrg(): number {
    const config = vscode.workspace.getConfiguration('github-pr-viewer');
    return config.get<number>('maxReposPerOrg', 100);
  }
}
