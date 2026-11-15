import { spawn } from 'node:child_process';

/**
 * A thin, injectable process runner for headless CLI calls (Codex, Claude
 * Code) — the process-execution equivalent of `fetch-types.ts`'s
 * `FetchImpl`: every external effect is injected, so `codex-cli-client.ts`/
 * `claude-cli-client.ts` are testable against a fake, process-free
 * implementation, and only `realRunCli` (wired in `cli.ts`) ever actually
 * spawns a process.
 */

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** The prompt always travels via stdin, never as an argv entry. */
export type RunCliImpl = (command: string, args: string[], stdin: string) => Promise<RunCliResult>;

/**
 * Windows specifically: `codex`/`claude` resolve to npm-installed `.cmd`
 * shims, which `CreateProcess` cannot execute directly — confirmed for
 * real, `spawn('codex', [...], { shell: false })` fails with `ENOENT` on
 * this machine. `shell: true` fixes resolution, but Node does NOT escape
 * array args in that mode (its own `DEP0190` deprecation warning says so
 * verbatim) — also confirmed for real: an unquoted argument containing a
 * space (this repo's own path, `...\Saka Shittu Adeyemi\...`, or any temp
 * file path under it) silently splits into multiple argv entries on the
 * far side, corrupting a `-o <path>`/`--output-schema <path>` flag.
 */
function quoteForWindowsShell(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/**
 * Real process execution — only `cli.ts` wires this in, exactly how
 * `fetch` itself is the one piece of `openai-client.ts` never unit-tested.
 *
 * The prompt is written to stdin rather than passed as a CLI argument,
 * which is what lets prompt text contain backslashes, `{{OPTION:A}}`-style
 * braces, currency symbols and newlines without any shell-quoting concern
 * at all — only our own fixed flags and file paths ever go through
 * `quoteForWindowsShell`, never arbitrary model-authored content.
 */
export const realRunCli: RunCliImpl = (command, args, stdin) =>
  new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const finalArgs = isWindows ? args.map(quoteForWindowsShell) : args;

    const child = spawn(command, finalArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
