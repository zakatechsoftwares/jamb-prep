import type { RunCliImpl } from './cli-exec';

/**
 * Wraps `codex exec`, replacing the direct OpenAI HTTP call `openai-client.ts`
 * made (this pipeline's authoring call) with the same subscription the user
 * already pays for via ChatGPT — no API key, no per-token billing. Confirmed
 * empirically on the real CLI before writing this: `codex exec` reads its
 * prompt from stdin when the positional argument is `-`, prints one JSON
 * event per line to stdout with `--json`, and supports real
 * JSON-Schema-constrained output via `--output-schema <file>` (the schema's
 * root must be `type: "object"` — a bare top-level array is rejected with a
 * real 400 from the underlying API, confirmed by a real failing call).
 *
 * Writing the schema file is deliberately NOT this module's job — it never
 * touches the filesystem, matching `openai-client.ts`'s own "every external
 * effect is injected" discipline. The caller (`run-generation.ts`/`cli.ts`)
 * writes the schema once and passes its path in.
 */

export interface CodexCliCallInput {
  prompt: string;
  model?: string;
  /** Path to an already-written JSON Schema file; root must be `type: "object"`. */
  outputSchemaPath?: string;
}

export interface CodexCliCallResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  /** The full parsed JSONL event stream, for the raw-response audit log. */
  rawResponse: unknown;
}

export class CodexCliError extends Error {
  constructor(
    public readonly exitCode: number,
    public readonly detail: string,
  ) {
    super(`codex exec failed (exit ${exitCode}): ${detail}`);
    this.name = 'CodexCliError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `--json` prints one JSON object per line. A stray non-JSON line is
 * skipped rather than failing the whole parse — confirmed for real that
 * stderr (not stdout) carries this CLI's background log noise, but
 * tolerating an odd stdout line costs nothing and protects against a
 * future CLI version interleaving something unexpected.
 */
function parseJsonLines(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        events.push(parsed);
      }
    } catch {
      // Not JSON -- skip rather than fail the whole stream over one line.
    }
  }
  return events;
}

export async function callCodexCli(
  runCli: RunCliImpl,
  input: CodexCliCallInput,
): Promise<CodexCliCallResult> {
  const args = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json'];
  if (input.model) {
    args.push('--model', input.model);
  }
  if (input.outputSchemaPath) {
    args.push('--output-schema', input.outputSchemaPath);
  }
  args.push('-');

  const result = await runCli('codex', args, input.prompt);
  const events = parseJsonLines(result.stdout);

  const failedEvent = events.find((event) => event.type === 'turn.failed' || event.type === 'error');
  if (failedEvent) {
    throw new CodexCliError(result.exitCode, JSON.stringify(failedEvent));
  }
  if (result.exitCode !== 0) {
    throw new CodexCliError(result.exitCode, result.stderr.trim() || 'no stderr output');
  }

  const messageEvent = events.find(
    (event) => event.type === 'item.completed' && isRecord(event.item) && event.item.type === 'agent_message',
  );
  const text =
    messageEvent && isRecord(messageEvent.item) && typeof messageEvent.item.text === 'string'
      ? messageEvent.item.text
      : '';

  const turnCompleted = events.find((event) => event.type === 'turn.completed');
  const usageRaw = turnCompleted && isRecord(turnCompleted.usage) ? turnCompleted.usage : undefined;
  const usage = {
    inputTokens: typeof usageRaw?.input_tokens === 'number' ? usageRaw.input_tokens : 0,
    outputTokens: typeof usageRaw?.output_tokens === 'number' ? usageRaw.output_tokens : 0,
  };

  return { text, usage, rawResponse: events };
}

/**
 * A detected usage-limit signal is non-retryable — failing fast beats
 * backing off into a multi-hour wall the subscription's own usage window
 * won't clear any faster for. Everything else retries, matching
 * `isRetryableOpenAiError`'s default-retry stance for an unrecognized or
 * process-level failure. The keyword list is a best-effort heuristic, not
 * a confirmed real usage-limit message (forcing a real cap exhaustion
 * wasn't practical to test) — refine it the first time a real one is
 * actually observed, the same spirit as this codebase's other documented
 * heuristics.
 */
const NON_RETRYABLE_PATTERN = /usage[\s_-]?limit|quota[\s_-]?exceeded/i;

export function isRetryableCodexCliError(error: unknown): boolean {
  if (error instanceof CodexCliError && NON_RETRYABLE_PATTERN.test(error.detail)) {
    return false;
  }
  return true;
}
