import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pool, withTransaction } from '@jamb/db';
import { formatGateReport } from './gate-report';
import { DEFAULT_LOG_DIR } from './raw-response-logger';
import { runGeneration, type RunGenerationOptions } from './run-generation';
import type { DifficultyTarget } from './authoring-prompt';
import { realRunCli } from './cli-exec';
import { loadLocalEmbedder } from './local-embedding-client';
import { AUTHORING_OUTPUT_SCHEMA } from './authoring-schema';

/**
 * `pnpm item-gen --subject chemistry --objective-id 42 --count 10` (BUILD
 * point 4). Thin: parses argv and env, wires the real CLI-process/DB/clock/
 * random/embedding dependencies, and hands off to `runGeneration`, which is
 * where the actual pipeline — and everything this session's tests cover —
 * lives.
 *
 * No `OPENAI_API_KEY`/`VOYAGE_API_KEY` here anymore — authoring and the
 * independent solve run through the user's own ChatGPT/Claude subscriptions
 * via `codex exec`/`claude -p` (`realRunCli`), and embeddings run locally
 * via `@huggingface/transformers`, no API key for either.
 */

const DEFAULT_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const logDir =
    process.env.ITEM_GEN_LOG_DIR ?? path.resolve(import.meta.dirname, '../../../', DEFAULT_LOG_DIR);

  // Written once per process, not per item/batch -- the schema is a fixed
  // constant, so there is nothing to regenerate between calls.
  const schemaDir = await mkdtemp(path.join(tmpdir(), 'item-gen-schema-'));
  const authoringOutputSchemaPath = path.join(schemaDir, 'authoring-output-schema.json');
  await writeFile(authoringOutputSchemaPath, JSON.stringify(AUTHORING_OUTPUT_SCHEMA), 'utf8');

  // Loaded once per process -- expensive (downloads/loads the ONNX model
  // on first use), never per item.
  const embedder = await loadLocalEmbedder(process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL);

  const client = await pool.connect();
  try {
    const report = await runGeneration(options, {
      readClient: client,
      withTransaction,
      runCli: realRunCli,
      codexModel: process.env.CODEX_MODEL,
      claudeModel: process.env.CLAUDE_MODEL,
      authoringOutputSchemaPath,
      embedder,
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
