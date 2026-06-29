/**
 * GitHub API data types for the PR Viewer extension.
 *
 * These mirror the GitHub REST API response shapes but only include
 * the fields we actually consume, keeping the type surface small.
 */

// ---------------------------------------------------------------------------
// Pull Request
// ---------------------------------------------------------------------------

export interface PR {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  user: GitHubUser;
  repository_url: string;
  html_url: string;
  body: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  created_at: string;
  updated_at: string;
  draft: boolean;
  labels: Label[];
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  requested_reviewers: GitHubUser[];
}

export interface Label {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

// ---------------------------------------------------------------------------
// Organization & Repository
// ---------------------------------------------------------------------------

export interface Organization {
  login: string;
  description: string | null;
  avatar_url: string;
}

export interface Repository {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  archived: boolean;
  fork: boolean;
}

// ---------------------------------------------------------------------------
// User Email
// ---------------------------------------------------------------------------

export interface UserEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Extension-internal types
// ---------------------------------------------------------------------------

export type PRState = 'open' | 'closed' | 'all';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface EmailValidationResult {
  email: string;
  isCompanyEmail: boolean;
  domain: string;
}
