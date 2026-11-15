import { describe, expect, it } from 'vitest';
import type { RunCliImpl, RunCliResult } from './cli-exec';
import { CodexCliError, callCodexCli, isRetryableCodexCliError } from './codex-cli-client';

interface Recorded {
  command: string;
  args: string[];
  stdin: string;
}

function fakeRunCli(result: RunCliResult): { runCli: RunCliImpl; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const runCli: RunCliImpl = async (command, args, stdin) => {
    calls.push({ command, args, stdin });
    return result;
  };
  return { runCli, calls };
}

function jsonl(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

describe('callCodexCli', () => {
  it('runs codex exec with the sandbox/json flags and the prompt on stdin', async () => {
    const { runCli, calls } = fakeRunCli({
      stdout: jsonl([
        { type: 'thread.started', thread_id: 't1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: '[]' } },
        { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
      ]),
      stderr: '',
      exitCode: 0,
    });

    await callCodexCli(runCli, { prompt: 'Write an item.' });

    expect(calls).toEqual([
      {
        command: 'codex',
        args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '-'],
        stdin: 'Write an item.',
      },
    ]);
  });

  it('includes --model and --output-schema when provided', async () => {
    const { runCli, calls } = fakeRunCli({
      stdout: jsonl([
        { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: '{}' } },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
      ]),
      stderr: '',
      exitCode: 0,
    });

    await callCodexCli(runCli, {
      prompt: 'go',
      model: 'gpt-5.1-codex',
      outputSchemaPath: 'C:\\tmp\\schema.json',
    });

    expect(calls[0]?.args).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--json',
      '--model',
      'gpt-5.1-codex',
      '--output-schema',
      'C:\\tmp\\schema.json',
      '-',
    ]);
  });

  it('extracts the agent_message text and token usage from the JSONL stream', async () => {
    const { runCli } = fakeRunCli({
      stdout: jsonl([
        { type: 'thread.started', thread_id: 't1' },
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: { id: 'item_0', type: 'agent_message', text: '{"items":[{"stem":"x"}]}' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 15128, cached_input_tokens: 12544, output_tokens: 13 },
        },
      ]),
      stderr: '',
      exitCode: 0,
    });

    const result = await callCodexCli(runCli, { prompt: 'go' });

    expect(result.text).toBe('{"items":[{"stem":"x"}]}');
    expect(result.usage).toEqual({ inputTokens: 15128, outputTokens: 13 });
  });

  it('throws CodexCliError when a turn.failed event appears in the stream', async () => {
    const { runCli } = fakeRunCli({
      stdout: jsonl([
        { type: 'thread.started', thread_id: 't1' },
        { type: 'turn.started' },
        {
          type: 'error',
          message: '{"type":"error","error":{"message":"Invalid schema","code":"invalid_json_schema"},"status":400}',
        },
        {
          type: 'turn.failed',
          error: { message: '{"type":"error","error":{"message":"Invalid schema"},"status":400}' },
        },
      ]),
      stderr: '',
      exitCode: 1,
    });

    await expect(callCodexCli(runCli, { prompt: 'go' })).rejects.toBeInstanceOf(CodexCliError);
  });

  it('throws CodexCliError on a nonzero exit with no turn.failed event', async () => {
    const { runCli } = fakeRunCli({ stdout: '', stderr: 'codex: command not found', exitCode: 127 });

    await expect(callCodexCli(runCli, { prompt: 'go' })).rejects.toMatchObject({ exitCode: 127 });
  });

  it('returns empty text rather than throwing when stdout has no agent_message event', async () => {
    const { runCli } = fakeRunCli({
      stdout: jsonl([{ type: 'thread.started', thread_id: 't1' }, { type: 'turn.started' }]),
      stderr: '',
      exitCode: 0,
    });

    const result = await callCodexCli(runCli, { prompt: 'go' });
    expect(result.text).toBe('');
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('isRetryableCodexCliError', () => {
  it('retries a generic CodexCliError', () => {
    expect(isRetryableCodexCliError(new CodexCliError(1, 'transient failure'))).toBe(true);
  });

  it('does not retry a detected usage-limit error', () => {
    expect(isRetryableCodexCliError(new CodexCliError(1, 'You have hit your usage limit'))).toBe(false);
    expect(isRetryableCodexCliError(new CodexCliError(1, 'quota_exceeded for this plan'))).toBe(false);
  });

  it('retries a non-CodexCliError (process-level) failure', () => {
    expect(isRetryableCodexCliError(new Error('spawn ENOENT'))).toBe(true);
  });
});
