import type { RunCliImpl } from './cli-exec';

/**
 * Wraps `claude -p`, replacing the direct OpenAI HTTP call `openai-client.ts`
 * made for this pipeline's independent-solve call with the user's existing
 * Claude subscription — no API key. Confirmed empirically on the real CLI
 * before writing this: `claude -p --output-format json` reads its prompt
 * from stdin via a `-` positional argument, and prints a single JSON object
 * (not JSONL) whose `result` field is a JSON *string* holding the model's
 * actual answer.
 *
 * `--bare` mode is deliberately never used here — its own `--help` text
 * states it forces `ANTHROPIC_API_KEY`/`apiKeyHelper` auth and never reads
 * OAuth/subscription credentials, which would silently reintroduce metered
 * billing, exactly the thing this module exists to avoid.
 *
 * `--permission-mode dontAsk --permission-prompts none` guarantees no
 * interactive hang: the solve prompt never asks for tool use, so nothing
 * should ever prompt, but this makes that a guarantee rather than an
 * assumption for unattended batch runs.
 *
 * The response also carries `total_cost_usd` and a per-model `costUSD`
 * breakdown — confirmed by a real call to be a list-price *estimate*
 * (observed: $0.32 for a one-line trivial reply, driven by this CLI's own
 * large fixed tool/system-prompt overhead), not a real charge under a flat
 * subscription. This module never reads either field — `item-gen-cost.ts`'s
 * `MODEL_PRICING` entry for this CLI is the correct, honest $0, not a
 * simplification.
 */

export interface ClaudeCliCallInput {
  prompt: string;
  model?: string;
}

export interface ClaudeCliCallResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  /** The full parsed response object, for the raw-response audit log. */
  rawResponse: unknown;
}

export class ClaudeCliError extends Error {
  constructor(
    public readonly exitCode: number,
    public readonly detail: string,
  ) {
    super(`claude -p failed (exit ${exitCode}): ${detail}`);
    this.name = 'ClaudeCliError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function callClaudeCli(
  runCli: RunCliImpl,
  input: ClaudeCliCallInput,
): Promise<ClaudeCliCallResult> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
  ];
  if (input.model) {
    args.push('--model', input.model);
  }
  args.push('-');

  const result = await runCli('claude', args, input.prompt);

  if (result.exitCode !== 0) {
    throw new ClaudeCliError(result.exitCode, result.stderr.trim() || 'no stderr output');
  }

  let body: unknown;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    throw new ClaudeCliError(result.exitCode, `stdout was not valid JSON: ${result.stdout.slice(0, 200)}`);
  }

  if (!isRecord(body)) {
    throw new ClaudeCliError(result.exitCode, `stdout was not a JSON object: ${result.stdout.slice(0, 200)}`);
  }
  if (body.is_error === true) {
    throw new ClaudeCliError(result.exitCode, JSON.stringify(body));
  }

  const text = typeof body.result === 'string' ? body.result : '';
  const usageRaw = isRecord(body.usage) ? body.usage : undefined;
  const usage = {
    inputTokens: typeof usageRaw?.input_tokens === 'number' ? usageRaw.input_tokens : 0,
    outputTokens: typeof usageRaw?.output_tokens === 'number' ? usageRaw.output_tokens : 0,
  };

  return { text, usage, rawResponse: body };
}

/**
 * Same heuristic and the same honest caveat as `isRetryableCodexCliError`:
 * a detected usage-limit signal is non-retryable, everything else retries.
 * Not yet confirmed against a real usage-cap error message — refine the
 * first time one is actually observed.
 */
const NON_RETRYABLE_PATTERN = /usage[\s_-]?limit|quota[\s_-]?exceeded/i;

export function isRetryableClaudeCliError(error: unknown): boolean {
  if (error instanceof ClaudeCliError && NON_RETRYABLE_PATTERN.test(error.detail)) {
    return false;
  }
  return true;
}
