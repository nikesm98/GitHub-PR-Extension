import * as vscode from 'vscode';

/**
 * Structured logger using VS Code's Output Channel.
 *
 * All extension logging goes through this instead of `console.log`
 * so users can see diagnostics via "Output → GitHub PR Viewer"
 * without polluting the developer console.
 */
export class Logger {
  private static channel: vscode.OutputChannel;

  static init(): void {
    if (!Logger.channel) {
      Logger.channel = vscode.window.createOutputChannel('GitHub PR Viewer');
    }
  }

  static info(message: string, ...args: unknown[]): void {
    Logger.write('INFO', message, ...args);
  }

  static warn(message: string, ...args: unknown[]): void {
    Logger.write('WARN', message, ...args);
  }

  static error(message: string, ...args: unknown[]): void {
    Logger.write('ERROR', message, ...args);
  }

  static debug(message: string, ...args: unknown[]): void {
    Logger.write('DEBUG', message, ...args);
  }

  /** Show the output channel panel to the user. */
  static show(): void {
    Logger.channel?.show(true);
  }

  static dispose(): void {
    Logger.channel?.dispose();
  }

  // -----------------------------------------------------------------------

  private static write(
    level: string,
    message: string,
    ...args: unknown[]
  ): void {
    if (!Logger.channel) {
      Logger.init();
    }

    const timestamp = new Date().toISOString();
    const extra = args.length
      ? ' ' + args.map((a) => JSON.stringify(a)).join(' ')
      : '';
    Logger.channel.appendLine(`[${timestamp}] [${level}] ${message}${extra}`);
  }
}
