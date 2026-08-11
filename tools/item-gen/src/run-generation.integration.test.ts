import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FetchImpl } from './anthropic-client';
import { runGeneration, type RunGenerationDependencies } from './run-generation';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

interface RecordedCall {
  url: string;
  body: Record<string, unknown>;
}

/** Pulls {label, text} pairs out of the solve prompt's OPTIONS block, so the fake solver survives permutation. */
function extractPromptOptions(content: string): { label: string; text: string }[] {
  const section = /OPTIONS:\n([\s\S]*?)\n\nReturn ONLY/.exec(content)?.[1] ?? '';
  return section
    .trim()
    .split('\n')
    .map((line) => /^([A-D])\.\s(.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ label: match[1]!, text: match[2]! }));
}

interface FakeApiConfig {
  authoringItems: unknown[];
  authoringUsage?: { input_tokens: number; output_tokens: number };
  /** stem substring -> the option TEXT the fake solver should agree with (by content, not letter, so it survives rebalancing). */
  agreeWithTextByStemSubstring: Record<string, string>;
  /** stem substring -> a fixed embedding vector. */
  embeddingByStemSubstring: Record<string, number[]>;
}

function buildFakeFetch(config: FakeApiConfig): { fetchImpl: FetchImpl; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const fetchImpl: FetchImpl = async (input, init) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    calls.push({ url, body });

    if (url.includes('anthropic.com')) {
      const messages = body.messages as { content: string }[];
      const content = messages[0]!.content;

      if (content.startsWith('You are an experienced Nigerian secondary school teacher')) {
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: JSON.stringify(config.authoringItems) }],
            usage: config.authoringUsage ?? { input_tokens: 500, output_tokens: 1500 },
          }),
          { status: 200 },
        );
      }

      // Independent solve call.
      const stemMatch = /QUESTION:\n([\s\S]*?)\n\nOPTIONS:/.exec(content);
      const stem = stemMatch?.[1]?.trim() ?? '';
      const options = extractPromptOptions(content);
      const agreeSubstringEntry = Object.entries(config.agreeWithTextByStemSubstring).find(
        ([substring]) => stem.includes(substring),
      );
      const agreeText = agreeSubstringEntry?.[1];
      const answerLabel =
        options.find((option) => option.text === agreeText)?.label ?? options[0]!.label;

      return new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: JSON.stringify({ answer: answerLabel, reasoning: 'fake' }) },
          ],
          usage: { input_tokens: 100, output_tokens: 30 },
        }),
        { status: 200 },
      );
    }

    if (url.includes('voyageai.com')) {
      const texts = body.input as string[];
      const text = texts[0]!;
      const substringEntry = Object.entries(config.embeddingByStemSubstring).find(([substring]) =>
        text.includes(substring),
      );
      const embedding = substringEntry?.[1] ?? [0, 0, 1];

      return new Response(JSON.stringify({ data: [{ embedding }], usage: { total_tokens: 20 } }), {
        status: 200,
      });
    }

    throw new Error(`fake fetch: unexpected URL ${url}`);
  };

  return { fetchImpl, calls };
}

describe.runIf(hasDatabase)('runGeneration', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('@jamb/db/fixtures').QueueWorld;
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('@jamb/db');
    const { seedQueueWorld } = await import('@jamb/db/fixtures');
    const client = await pool.connect();

    try {
      const world = await seedQueueWorld(client);
      return await run({ client, world });
    } finally {
      client.release();
    }
  }

  async function truncate(): Promise<void> {
    const { pool } = await import('@jamb/db');
    const { truncateQueueWorld } = await import('@jamb/db/fixtures');
    const client = await pool.connect();
    try {
      await truncateQueueWorld(client);
    } finally {
      client.release();
    }
  }

  beforeEach(truncate);
  afterAll(async () => {
    await truncate();
    const { pool } = await import('@jamb/db');
    await pool.end();
  });

  async function baseDeps(
    fetchImpl: FetchImpl,
    client: import('pg').PoolClient,
    random: () => number,
  ): Promise<RunGenerationDependencies> {
    const { withTransaction } = await import('@jamb/db');
    return {
      readClient: client,
      withTransaction,
      fetchImpl,
      anthropicApiKey: 'test-key',
      anthropicModel: 'claude-sonnet-5',
      voyageApiKey: 'test-voyage-key',
      voyageModel: 'voyage-3',
      random,
      sleep: async () => {},
      now: () => new Date('2026-08-10T12:00:00.000Z'),
      logDir: await (async () => {
        const os = await import('node:os');
        const path = await import('node:path');
        const fs = await import('node:fs/promises');
        return fs.mkdtemp(path.join(os.tmpdir(), 'item-gen-test-'));
      })(),
    };
  }

  const ITEM_FORCE = {
    id: '1',
    subject: 'Physics',
    topic: 'Mechanics',
    subtopic: 'Force',
    objective: 'x',
    cognitive_level: 'recall',
    author_difficulty: 0.3,
    expected_time_seconds: 40,
    stem: 'What is the SI unit of force?',
    options: { A: 'newton', B: 'joule', C: 'watt', D: 'pascal' },
    correct_option: 'A',
    distractor_rationale: {
      B: 'confuses force with energy',
      C: 'confuses force with power',
      D: 'confuses force with pressure',
    },
    explanation: 'The newton, {{OPTION:A}}, is the SI unit of force.',
    method_steps: ['Recall F = ma.'],
    contains_calculation: false,
    status: 'generated',
  };

  const ITEM_HISTORY = {
    id: '2',
    subject: 'Physics',
    topic: 'Mechanics',
    subtopic: 'History',
    objective: 'x',
    cognitive_level: 'recall',
    author_difficulty: 0.3,
    expected_time_seconds: 40,
    stem: 'Who formulated the three laws of motion?',
    options: {
      A: 'Isaac Newton',
      B: 'Albert Einstein',
      C: 'Galileo Galilei',
      D: 'Michael Faraday',
    },
    correct_option: 'A',
    distractor_rationale: {
      B: 'confuses classical mechanics with relativity',
      C: 'confuses with early motion studies',
      D: 'confuses with electromagnetism',
    },
    explanation: 'Isaac Newton, {{OPTION:A}}, formulated the three laws of motion.',
    method_steps: [],
    contains_calculation: false,
    status: 'generated',
  };

  const ITEM_MISSING_RATIONALE = {
    id: '3',
    subject: 'Physics',
    topic: 'Mechanics',
    subtopic: 'Units',
    objective: 'x',
    cognitive_level: 'recall',
    author_difficulty: 0.3,
    expected_time_seconds: 40,
    stem: 'Which of these is a vector quantity?',
    options: { A: 'mass', B: 'velocity', C: 'time', D: 'temperature' },
    correct_option: 'B',
    distractor_rationale: {
      A: '',
      C: 'confuses scalar time with vector',
      D: 'confuses scalar temperature with vector',
    },
    explanation: 'Velocity, {{OPTION:B}}, is a vector quantity.',
    method_steps: [],
    contains_calculation: false,
    status: 'generated',
  };

  it('runs the full batch: agrees to auto_gated, disagrees to pending_review, schema failure to gate_failed', async () => {
    await withWorld(async ({ client, world }) => {
      const { fetchImpl, calls } = buildFakeFetch({
        authoringItems: [ITEM_FORCE, ITEM_HISTORY, ITEM_MISSING_RATIONALE],
        agreeWithTextByStemSubstring: {
          'SI unit of force': 'newton',
          'three laws of motion': 'Albert Einstein', // deliberately WRONG -> forces disagreement
        },
        embeddingByStemSubstring: {
          'SI unit of force': [1, 0, 0],
          'three laws of motion': [0, 1, 0],
        },
      });

      const deps = await baseDeps(fetchImpl, client, () => 0.5); // 0.5 >= 0.3 sample rate -> never sampled
      // Biology, not Physics -- deriveRiskTier tiers Physics/Mathematics/
      // Chemistry high as a whole category regardless of calculation
      // content (packages/db/risk-tier.ts), which would make an auto_gated
      // outcome impossible here.
      const report = await runGeneration(
        {
          subject: 'Biology',
          objectiveId: world.otherObjectiveId,
          count: 3,
          difficultyTarget: 'moderate',
          cognitiveLevel: 'recall',
        },
        deps,
      );

      expect(report.items).toHaveLength(3);
      const outcomes = report.items.map((item) => item.outcome).sort();
      expect(outcomes).toEqual(['auto_gated', 'gate_failed', 'pending_review']);

      const gateFailed = report.items.find((item) => item.outcome === 'gate_failed')!;
      expect(gateFailed.schemaFailures).toContain('missing_distractor_rationale');
      expect(gateFailed.independentSolveVerdict).toBe('not_run');

      const pendingReview = report.items.find((item) => item.outcome === 'pending_review')!;
      expect(pendingReview.independentSolveVerdict).toBe('disagreed');

      const autoGated = report.items.find((item) => item.outcome === 'auto_gated')!;
      expect(autoGated.independentSolveVerdict).toBe('agreed');
      expect(autoGated.riskTier).toBe('low');
      expect(autoGated.sampledForReview).toBe(false);

      // The solve call never happened for the schema-failed item -- verify
      // by counting Anthropic calls: 1 authoring + 2 solves (not 3).
      const anthropicCalls = calls.filter((c) => c.url.includes('anthropic.com'));
      expect(anthropicCalls).toHaveLength(3); // 1 authoring + 2 solves

      // Rows actually landed with the right status in the database.
      const rows = await client.query<{ status: string; approval_route: string | null }>(
        `SELECT status, approval_route FROM items WHERE subject_id = $1 ORDER BY id`,
        [world.otherSubjectId],
      );
      const statuses = rows.rows.map((r) => r.status).sort();
      expect(statuses).toEqual(['approved_uncalibrated', 'gate_failed', 'pending_review']);
    });
  }, 20000);

  it('flags a near-duplicate of the live bank as gate_failed, without ever calling the solve API for it', async () => {
    await withWorld(async ({ client, world }) => {
      // Seed a pre-existing live item with a known embedding.
      const { insertGeneratedItem } = await import('@jamb/db');
      const existingItemId = await insertGeneratedItem(client, {
        subjectId: world.subjectId,
        topicId: world.topicId,
        subtopicId: world.subtopicId,
        objectiveId: world.objectiveId,
        stem: 'An existing, already-approved item.',
        explanation: 'x',
        methodSteps: [],
        cognitiveLevel: 'recall',
        authorDifficulty: 0.3,
        expectedTimeSeconds: 40,
        riskTier: 'low',
        independentSolveVerdict: 'agreed',
        sampledForReview: false,
        stemEmbedding: [1, 0, 0],
        inferenceCostUsd: 0.01,
        provenance: {},
        options: [
          { label: 'A', text: 'x', isCorrect: true, distractorRationale: null },
          { label: 'B', text: 'y', isCorrect: false, distractorRationale: 'r' },
          { label: 'C', text: 'z', isCorrect: false, distractorRationale: 'r' },
          { label: 'D', text: 'w', isCorrect: false, distractorRationale: 'r' },
        ],
      });
      await client.query(`UPDATE items SET status = 'approved_uncalibrated' WHERE id = $1`, [
        existingItemId,
      ]);

      const { fetchImpl, calls } = buildFakeFetch({
        authoringItems: [ITEM_FORCE],
        agreeWithTextByStemSubstring: { 'SI unit of force': 'newton' },
        // Same embedding as the existing item -> similarity 1.0, well above threshold.
        embeddingByStemSubstring: { 'SI unit of force': [1, 0, 0] },
      });

      const deps = await baseDeps(fetchImpl, client, () => 0.5);
      const report = await runGeneration(
        {
          subject: 'Physics',
          objectiveId: world.objectiveId,
          count: 1,
          difficultyTarget: 'moderate',
          cognitiveLevel: 'recall',
        },
        deps,
      );

      expect(report.items).toHaveLength(1);
      expect(report.items[0]).toMatchObject({
        outcome: 'gate_failed',
        duplicateOfItemId: existingItemId,
      });
      expect(report.items[0]?.duplicateSimilarity).toBeCloseTo(1, 6);

      // No solve call was made for the flagged duplicate: 1 authoring + 1 embedding, 0 solves.
      const anthropicCalls = calls.filter((c) => c.url.includes('anthropic.com'));
      expect(anthropicCalls).toHaveLength(1);
    });
  }, 20000);

  it('samples a qualifying low-risk item for human review instead of auto-gating it', async () => {
    await withWorld(async ({ client, world }) => {
      const { fetchImpl } = buildFakeFetch({
        authoringItems: [ITEM_FORCE],
        agreeWithTextByStemSubstring: { 'SI unit of force': 'newton' },
        embeddingByStemSubstring: { 'SI unit of force': [1, 0, 0] },
      });

      // 0.01 < 0.3 sample rate -> always sampled. Single item, so no
      // concurrency ambiguity about which random() call this is. Biology,
      // not Physics -- see the full-batch test's own comment on risk tiering.
      const deps = await baseDeps(fetchImpl, client, () => 0.01);
      const report = await runGeneration(
        {
          subject: 'Biology',
          objectiveId: world.otherObjectiveId,
          count: 1,
          difficultyTarget: 'moderate',
          cognitiveLevel: 'recall',
        },
        deps,
      );

      expect(report.items[0]).toMatchObject({
        outcome: 'pending_review',
        independentSolveVerdict: 'agreed',
        riskTier: 'low',
        sampledForReview: true,
      });
    });
  }, 20000);

  it('discards a structurally malformed authored item before ever inserting it', async () => {
    await withWorld(async ({ client, world }) => {
      const { fetchImpl } = buildFakeFetch({
        authoringItems: [ITEM_FORCE, { stem: '' }], // second entry has no usable stem
        agreeWithTextByStemSubstring: { 'SI unit of force': 'newton' },
        embeddingByStemSubstring: { 'SI unit of force': [1, 0, 0] },
      });

      const deps = await baseDeps(fetchImpl, client, () => 0.5);
      const report = await runGeneration(
        {
          subject: 'Physics',
          objectiveId: world.objectiveId,
          count: 2,
          difficultyTarget: 'moderate',
          cognitiveLevel: 'recall',
        },
        deps,
      );

      expect(report.items).toHaveLength(2);
      const discarded = report.items.find((item) => item.outcome === 'discarded_before_insert')!;
      expect(discarded.itemId).toBeNull();
      expect(discarded.inferenceCostUsd).toBeNull();
    });
  }, 20000);

  it("rejects a --subject that does not match the objective's real subject", async () => {
    await withWorld(async ({ client, world }) => {
      const { fetchImpl } = buildFakeFetch({
        authoringItems: [ITEM_FORCE],
        agreeWithTextByStemSubstring: {},
        embeddingByStemSubstring: {},
      });
      const deps = await baseDeps(fetchImpl, client, () => 0.5);

      await expect(
        runGeneration(
          {
            subject: 'Chemistry',
            objectiveId: world.objectiveId,
            count: 1,
            difficultyTarget: 'moderate',
            cognitiveLevel: 'recall',
          },
          deps,
        ),
      ).rejects.toThrow(/subject/i);
    });
  });

  it('apportions the full authoring cost across the inserted items and accounts for solve cost separately', async () => {
    await withWorld(async ({ client, world }) => {
      const { fetchImpl } = buildFakeFetch({
        authoringItems: [ITEM_FORCE, ITEM_HISTORY],
        authoringUsage: { input_tokens: 1_000_000, output_tokens: 0 }, // exactly the per-million input rate in USD
        agreeWithTextByStemSubstring: {
          'SI unit of force': 'newton',
          'three laws of motion': 'Isaac Newton',
        },
        embeddingByStemSubstring: {
          'SI unit of force': [1, 0, 0],
          'three laws of motion': [0, 1, 0],
        },
      });

      const deps = await baseDeps(fetchImpl, client, () => 0.5);
      const report = await runGeneration(
        {
          subject: 'Physics',
          objectiveId: world.objectiveId,
          count: 2,
          difficultyTarget: 'moderate',
          cognitiveLevel: 'recall',
        },
        deps,
      );

      // claude-sonnet-5's input rate is $3/million (item-gen-cost.ts) -> authoring call cost = $3.
      expect(report.totalAuthoringCostUsd).toBeCloseTo(3, 6);
      // Split evenly across the 2 inserted items: $1.5 each, plus each item's own (tiny) solve cost.
      const perItemAuthoringShare = 3 / 2;
      for (const item of report.items) {
        expect(item.inferenceCostUsd).toBeGreaterThan(perItemAuthoringShare);
      }
      expect(report.totalInferenceCostUsd).toBeCloseTo(
        report.items.reduce((sum, item) => sum + (item.inferenceCostUsd ?? 0), 0),
        6,
      );
    });
  }, 20000);
});
