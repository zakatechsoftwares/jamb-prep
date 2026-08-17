import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, withTransaction } from '@jamb/db';
import { formatGateReport } from './gate-report';
import { DEFAULT_LOG_DIR } from './raw-response-logger';
import { runGeneration, type RunGenerationOptions } from './run-generation';
import type { DifficultyTarget } from './authoring-prompt';

/**
 * `pnpm item-gen --subject chemistry --objective-id 42 --count 10` (BUILD
 * point 4). Thin: parses argv and env, wires the real HTTP/DB/clock/random
 * dependencies, and hands off to `runGeneration`, which is where the
 * actual pipeline — and everything this session's tests cover — lives.
 */

const DIFFICULTY_TARGETS: readonly DifficultyTarget[] = ['easy', 'moderate', 'challenging'];

function parseArgs(argv: string[]): RunGenerationOptions {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`item-gen: --${key} requires a value`);
      }
      flags[key] = value;
      i += 1;
    }
  }

  const subject = flags.subject;
  if (!subject) {
    throw new Error('item-gen: --subject is required');
  }

  const objectiveIdRaw = flags['objective-id'];
  const objectiveId = Number(objectiveIdRaw);
  if (!objectiveIdRaw || !Number.isInteger(objectiveId) || objectiveId <= 0) {
    throw new Error('item-gen: --objective-id is required and must be a positive integer');
  }

  const countRaw = flags.count ?? '10';
  const count = Number(countRaw);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('item-gen: --count must be a positive integer');
  }

  const difficultyTarget = (flags.difficulty ?? 'moderate') as DifficultyTarget;
  if (!DIFFICULTY_TARGETS.includes(difficultyTarget)) {
    throw new Error(`item-gen: --difficulty must be one of ${DIFFICULTY_TARGETS.join(', ')}`);
  }

  const cognitiveLevel = flags['cognitive-level'] ?? 'application';

  return { subject, objectiveId, count, difficultyTarget, cognitiveLevel };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`item-gen: ${name} is not set`);
  }
  return value;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const openaiApiKey = requireEnv('OPENAI_API_KEY');
  const voyageApiKey = requireEnv('VOYAGE_API_KEY');
  const logDir =
    process.env.ITEM_GEN_LOG_DIR ?? path.resolve(import.meta.dirname, '../../../', DEFAULT_LOG_DIR);

  const client = await pool.connect();
  try {
    const report = await runGeneration(options, {
      readClient: client,
      withTransaction,
      fetchImpl: fetch,
      openaiApiKey,
      openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1',
      voyageApiKey,
      voyageModel: process.env.VOYAGE_MODEL ?? 'voyage-3',
      random: Math.random,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
      logDir,
    });

    console.log(formatGateReport(report));

    const reportPath = path.join(
      logDir,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-objective-${options.objectiveId}-gate-report.json`,
    );
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nFull gate report written to ${reportPath}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
