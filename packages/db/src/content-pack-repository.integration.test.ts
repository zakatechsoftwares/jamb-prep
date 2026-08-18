import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.PGPOOL_MAX ??= '10';

const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * Content sync's server-side pack delivery (plan 8.3, follow-up to
 * progress-sync) against a real database, reusing `review-queue.fixtures.ts`'s
 * `seedQueueWorld`/`insertQueueItem` -- the same real subjects/syllabus
 * fixture every other content-facing integration test in this package
 * already builds on.
 */
describe.runIf(hasDatabase)('content-pack-repository', () => {
  async function withWorld<T>(
    run: (context: {
      client: import('pg').PoolClient;
      world: import('./review-queue.fixtures').QueueWorld;
      fixtures: typeof import('./review-queue.fixtures');
      repo: typeof import('./content-pack-repository');
    }) => Promise<T>,
  ): Promise<T> {
    const { pool } = await import('./client');
    const fixtures = await import('./review-queue.fixtures');
    const repo = await import('./content-pack-repository');
    const client = await pool.connect();

    try {
      const world = await fixtures.seedQueueWorld(client);
      return await run({ client, world, fixtures, repo });
    } finally {
      client.release();
    }
  }

  beforeEach(async () => {
    const { pool } = await import('./client');
    const { truncateQueueWorld } = await import('./review-queue.fixtures');
    const client = await pool.connect();
    try {
      await truncateQueueWorld(client);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const { pool } = await import('./client');
    const { truncateQueueWorld } = await import('./review-queue.fixtures');
    const client = await pool.connect();
    try {
      await truncateQueueWorld(client);
    } finally {
      client.release();
      await pool.end();
    }
  });

  describe('listAvailableSubjectPacks', () => {
    it('lists only subjects with at least one approved item, counting only approved items', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
        await fixtures.insertQueueItem(client, world, { status: 'approved_calibrated' });
        await fixtures.insertQueueItem(client, world, { status: 'pending_review' });
        // otherSubjectId (Biology) has no approved items at all.
        await fixtures.insertQueueItem(client, world, {
          subjectId: world.otherSubjectId,
          status: 'pending_review',
        });

        const manifest = await repo.listAvailableSubjectPacks(client);

        expect(manifest.map((entry) => entry.subjectId)).toEqual([world.subjectId]);
        expect(manifest[0]).toMatchObject({ subjectId: world.subjectId, itemCount: 2 });
        expect(manifest[0]!.version).not.toBe('');
      });
    });

    it('returns an empty list when nothing is approved anywhere', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        await fixtures.insertQueueItem(client, world, { status: 'pending_review' });
        expect(await repo.listAvailableSubjectPacks(client)).toEqual([]);
      });
    });

    it('changes the version when an item is added', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
        const before = await repo.listAvailableSubjectPacks(client);

        await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
        const after = await repo.listAvailableSubjectPacks(client);

        expect(after[0]!.version).not.toBe(before[0]!.version);
        expect(after[0]!.itemCount).toBe(2);
      });
    });

    it('changes the version when an approved item is edited (its own version bumped)', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const itemId = await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
        const before = await repo.listAvailableSubjectPacks(client);

        await client.query(`UPDATE items SET version = version + 1 WHERE id = $1`, [itemId]);
        const after = await repo.listAvailableSubjectPacks(client);

        expect(after[0]!.version).not.toBe(before[0]!.version);
        expect(after[0]!.itemCount).toBe(1);
      });
    });

    it('changes the version when an item is retired out of the approved set', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
        const stillLiveId = await fixtures.insertQueueItem(client, world, {
          status: 'approved_uncalibrated',
        });
        const before = await repo.listAvailableSubjectPacks(client);
        void stillLiveId;

        await client.query(`UPDATE items SET status = 'retired' WHERE id = $1`, [stillLiveId]);
        const after = await repo.listAvailableSubjectPacks(client);

        expect(after[0]!.itemCount).toBe(1);
        expect(after[0]!.version).not.toBe(before[0]!.version);
      });
    });
  });

  describe('loadSubjectPack', () => {
    it('returns full item content for approved items only, including the key', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
        await fixtures.insertQueueItem(client, world, { status: 'pending_review' });

        const pack = await repo.loadSubjectPack(world.subjectId, client);

        expect(pack).not.toBeNull();
        expect(pack!.subjectId).toBe(world.subjectId);
        expect(pack!.items).toHaveLength(1);
        const [item] = pack!.items;
        expect(item).toMatchObject({ stem: 'stem', explanation: 'explanation', cognitiveLevel: 'recall' });
        expect(item!.options.filter((option) => option.isCorrect)).toHaveLength(1);
        expect(item!.diagram).toBeNull();
      });
    });

    it('includes a completed illustration ticket as the item diagram', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const itemId = await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
        await client.query(
          `INSERT INTO illustration_tickets (
             item_id, requested_by, figure_description, sketch_photo, sketch_photo_content_type,
             status, claimed_by, claimed_at, svg_asset, alt_text, completed_at
           ) VALUES ($1, $2, 'a diagram', $3, 'image/jpeg', 'completed', $2, now(), $4, $5, now())`,
          [itemId, world.reviewerUserId, Buffer.from('fake'), '<svg></svg>', 'a labelled diagram'],
        );

        const pack = await repo.loadSubjectPack(world.subjectId, client);

        expect(pack!.items[0]!.diagram).toEqual({ svgMarkup: '<svg></svg>', altText: 'a labelled diagram' });
      });
    });

    it('does not surface an illustration ticket that is still open', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        const itemId = await fixtures.insertQueueItem(client, world, { status: 'approved_uncalibrated' });
        await client.query(
          `INSERT INTO illustration_tickets (item_id, requested_by, figure_description, sketch_photo, sketch_photo_content_type)
           VALUES ($1, $2, 'a diagram', $3, 'image/jpeg')`,
          [itemId, world.reviewerUserId, Buffer.from('fake')],
        );

        const pack = await repo.loadSubjectPack(world.subjectId, client);

        expect(pack!.items[0]!.diagram).toBeNull();
      });
    });

    it('returns null for a subject with no approved items', async () => {
      await withWorld(async ({ client, world, fixtures, repo }) => {
        await fixtures.insertQueueItem(client, world, { status: 'pending_review' });
        expect(await repo.loadSubjectPack(world.subjectId, client)).toBeNull();
      });
    });

    it('returns null for an unknown subject id', async () => {
      await withWorld(async ({ client, repo }) => {
        expect(await repo.loadSubjectPack(999999, client)).toBeNull();
      });
    });
  });
});
