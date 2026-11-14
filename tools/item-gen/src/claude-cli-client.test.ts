import { describe, expect, it } from 'vitest';
import type { RunCliImpl, RunCliResult } from './cli-exec';
import { ClaudeCliError, callClaudeCli, isRetryableClaudeCliError } from './claude-cli-client';

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

describe('callClaudeCli', () => {
  it('runs claude -p with the output-format/permission flags and the prompt on stdin', async () => {
    const { runCli, calls } = fakeRunCli({
      stdout: JSON.stringify({
        is_error: false,
        subtype: 'success',
        result: '{"answer":"B","reasoning":"test"}',
        usage: { input_tokens: 2, output_tokens: 19 },
        total_cost_usd: 0.32,
      }),
      stderr: '',
      exitCode: 0,
    });

    await callClaudeCli(runCli, { prompt: 'Solve this.' });

    expect(calls).toEqual([
      {
        command: 'claude',
        args: ['-p', '--output-format', 'json', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '-'],
        stdin: 'Solve this.',
      },
    ]);
  });

  it('includes --model when provided', async () => {
    const { runCli, calls } = fakeRunCli({
      stdout: JSON.stringify({
        is_error: false,
        subtype: 'success',
        result: '{}',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      stderr: '',
      exitCode: 0,
    });

    await callClaudeCli(runCli, { prompt: 'go', model: 'claude-opus-5-5' });

    expect(calls[0]?.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'dontAsk',
      '--permission-prompts',
      'none',
      '--model',
      'claude-opus-5-5',
      '-',
    ]);
  });

  it('extracts the result text and token usage, ignoring the reported dollar cost', async () => {
    const { runCli } = fakeRunCli({
      stdout: JSON.stringify({
        is_error: false,
        subtype: 'success',
        result: '{"answer":"A","reasoning":"because"}',
        usage: { input_tokens: 912, output_tokens: 10 },
        total_cost_usd: 0.323774,
        modelUsage: { 'claude-opus-5-5': { costUSD: 0.322812 } },
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await callClaudeCli(runCli, { prompt: 'go' });

    expect(result.text).toBe('{"answer":"A","reasoning":"because"}');
    expect(result.usage).toEqual({ inputTokens: 912, outputTokens: 10 });
    expect(result).not.toHaveProperty('totalCostUsd');
  });

  it('throws ClaudeCliError when is_error is true', async () => {
    const { runCli } = fakeRunCli({
      stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: '' }),
      stderr: '',
      exitCode: 0,
    });

    await expect(callClaudeCli(runCli, { prompt: 'go' })).rejects.toBeInstanceOf(ClaudeCliError);
  });

  it('throws ClaudeCliError on a nonzero exit code', async () => {
    const { runCli } = fakeRunCli({ stdout: '', stderr: 'claude: command not found', exitCode: 127 });

    await expect(callClaudeCli(runCli, { prompt: 'go' })).rejects.toMatchObject({ exitCode: 127 });
  });

  it('throws ClaudeCliError when stdout is not valid JSON', async () => {
    const { runCli } = fakeRunCli({ stdout: 'not json at all', stderr: '', exitCode: 0 });

    await expect(callClaudeCli(runCli, { prompt: 'go' })).rejects.toBeInstanceOf(ClaudeCliError);
  });
});

describe('isRetryableClaudeCliError', () => {
  it('retries a generic ClaudeCliError', () => {
    expect(isRetryableClaudeCliError(new ClaudeCliError(1, 'transient failure'))).toBe(true);
  });

  it('does not retry a detected usage-limit error', () => {
    expect(isRetryableClaudeCliError(new ClaudeCliError(1, 'You have hit your usage limit'))).toBe(false);
    expect(isRetryableClaudeCliError(new ClaudeCliError(1, 'quota_exceeded for this plan'))).toBe(false);
  });

  it('retries a non-ClaudeCliError (process-level) failure', () => {
    expect(isRetryableClaudeCliError(new Error('spawn ENOENT'))).toBe(true);
  });
});
