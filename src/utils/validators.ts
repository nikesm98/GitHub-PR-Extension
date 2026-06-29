import * as vscode from 'vscode';
import type { EmailValidationResult, UserEmail } from '../github/types';

/**
 * Validates a user's GitHub email against company domains configured in
 * VS Code settings (`github-pr-viewer.companyDomains`).
 *
 * If no domains are configured the check is skipped and always passes.
 */
export class CompanyEmailValidator {
  /**
   * Fetch the user's primary email from GitHub and check it against
   * the configured company domain allow-list.
   */
  async validate(token: string): Promise<EmailValidationResult> {
    const response = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'github-pr-viewer-vscode',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user emails: ${response.statusText}`);
    }

    const emails: UserEmail[] = (await response.json()) as UserEmail[];
    const primary = emails.find((e) => e.primary);
    const email = primary?.email ?? '';
    const domain = email.split('@')[1] ?? '';

    const companyDomains = this.getConfiguredDomains();

    // If no domains configured, skip validation (always pass)
    const isCompanyEmail =
      companyDomains.length === 0 || companyDomains.includes(domain);

    return { email, isCompanyEmail, domain };
  }

  /** Read company domains from VS Code settings. */
  private getConfiguredDomains(): string[] {
    const config = vscode.workspace.getConfiguration('github-pr-viewer');
    return config.get<string[]>('companyDomains', []);
  }
}
