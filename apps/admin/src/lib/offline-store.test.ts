import { afterEach, describe, expect, it } from 'vitest';
import type { ReviewQueueItem } from '@jamb/shared';
import { createOfflineStore, type OfflineStore } from './offline-store';

let seq = 0;
/** A fresh database name per test — fake-indexeddb persists per name for the
 * life of the process, and nothing here resets it between tests. */
function freshDbName(): string {
  seq += 1;
  return `offline-store-test-${seq}`;
}

const openStores: OfflineStore[] = [];
afterEach(() => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
});

async function openStore(): Promise<OfflineStore> {
  const store = await createOfflineStore(freshDbName());
  openStores.push(store);
  return store;
}

function makeItem(itemId: number, claimExpiresAt = new Date('2026-08-09T12:00:00Z')): ReviewQueueItem {
  return {
    itemId,
    subjectId: 1,
    objectiveId: 1,
    stem: `stem ${itemId}`,
    options: [
      { label: 'A', text: 'option A' },
      { label: 'B', text: 'option B' },
      { label: 'C', text: 'option C' },
      { label: 'D', text: 'option D' },
    ],
    cognitiveLevel: 'recall',
    independentSolveVerdict: 'agreed',
    claimExpiresAt,
    diagram: null,
  };
}

describe('cached items', () => {
  it('starts empty', async () => {
    const store = await openStore();
    expect(await store.getCachedItems()).toEqual([]);
    expect(await store.countCachedItems()).toBe(0);
  });

  it('caches a low-tier item with its reveal payload prefetched', async () => {
    const store = await openStore();
    const item = makeItem(1);
    const reveal = {
      correctOption: 'A' as const,
      explanation: 'because',
      verdict: 'agreed' as const,
      agreesWithKey: null,
    };
    await store.cacheItems([{ item, reveal, cachedAt: new Date('2026-08-09T10:00:00Z') }]);

    const cached = await store.getCachedItems();
    expect(cached).toHaveLength(1);
    expect(cached[0]?.item).toEqual(item);
    expect(cached[0]?.reveal).toEqual(reveal);
    expect(await store.countCachedItems()).toBe(1);
  });

  it('caches a high-tier item with no reveal, since reveal stays online-only', async () => {
    const store = await openStore();
    const item = makeItem(2);
    await store.cacheItems([{ item, reveal: null, cachedAt: new Date('2026-08-09T10:00:00Z') }]);

    const cached = await store.getCachedItems();
    expect(cached[0]?.reveal).toBeNull();
  });

  it('preserves claimExpiresAt as a real Date, not a serialised string', async () => {
    const store = await openStore();
    const expiresAt = new Date('2026-08-09T12:34:56Z');
    await store.cacheItems([{ item: makeItem(3, expiresAt), reveal: null, cachedAt: new Date() }]);

    const [cached] = await store.getCachedItems();
    expect(cached?.item.claimExpiresAt).toBeInstanceOf(Date);
    expect(cached?.item.claimExpiresAt.toISOString()).toBe(expiresAt.toISOString());
  });

  it('removes a cached item by itemId', async () => {
    const store = await openStore();
    await store.cacheItems([
      { item: makeItem(1), reveal: null, cachedAt: new Date() },
      { item: makeItem(2), reveal: null, cachedAt: new Date() },
    ]);

    await store.removeCachedItem(1);

    const cached = await store.getCachedItems();
    expect(cached.map((c) => c.item.itemId)).toEqual([2]);
  });

  it('overwrites an existing cache entry for the same itemId rather than duplicating it', async () => {
    const store = await openStore();
    await store.cacheItems([{ item: makeItem(1), reveal: null, cachedAt: new Date() }]);
    await store.cacheItems([
      {
        item: makeItem(1),
        reveal: { correctOption: 'B', explanation: 'e', verdict: 'agreed', agreesWithKey: null },
        cachedAt: new Date(),
      },
    ]);

    const cached = await store.getCachedItems();
    expect(cached).toHaveLength(1);
    expect(cached[0]?.reveal?.correctOption).toBe('B');
  });

  it('reports the earliest claim expiry across cached items', async () => {
    const store = await openStore();
    expect(await store.nextClaimExpiry()).toBeNull();

    await store.cacheItems([
      { item: makeItem(1, new Date('2026-08-09T14:00:00Z')), reveal: null, cachedAt: new Date() },
      { item: makeItem(2, new Date('2026-08-09T12:00:00Z')), reveal: null, cachedAt: new Date() },
    ]);

    expect(await store.nextClaimExpiry()).toEqual(new Date('2026-08-09T12:00:00Z'));
  });
});

describe('pending decisions', () => {
  it('starts empty', async () => {
    const store = await openStore();
    expect(await store.getPendingDecisions()).toEqual([]);
    expect(await store.countPendingDecisions()).toBe(0);
  });

  it('queues a decision keyed by idempotency key', async () => {
    const store = await openStore();
    await store.queueDecision({
      idempotencyKey: 'key-1',
      itemId: 5,
      input: { action: 'approve' },
      queuedAt: new Date('2026-08-09T10:00:00Z'),
    });

    const pending = await store.getPendingDecisions();
    expect(pending).toEqual([
      {
        idempotencyKey: 'key-1',
        itemId: 5,
        input: { action: 'approve' },
        queuedAt: new Date('2026-08-09T10:00:00Z'),
      },
    ]);
    expect(await store.countPendingDecisions()).toBe(1);
  });

  it('removes a queued decision once it has synced', async () => {
    const store = await openStore();
    await store.queueDecision({
      idempotencyKey: 'key-1',
      itemId: 5,
      input: { action: 'approve' },
      queuedAt: new Date(),
    });
    await store.removePendingDecision('key-1');

    expect(await store.getPendingDecisions()).toEqual([]);
  });

  it('keeps two different queued decisions for two different items distinct', async () => {
    const store = await openStore();
    await store.queueDecision({
      idempotencyKey: 'key-1',
      itemId: 5,
      input: { action: 'reject', rejectionReason: 'wrong_key' },
      queuedAt: new Date(),
    });
    await store.queueDecision({
      idempotencyKey: 'key-2',
      itemId: 6,
      input: { action: 'approve' },
      queuedAt: new Date(),
    });

    expect(await store.countPendingDecisions()).toBe(2);
  });
});

describe('pending solves', () => {
  it('starts empty', async () => {
    const store = await openStore();
    expect(await store.getPendingSolves()).toEqual([]);
    expect(await store.countPendingSolves()).toBe(0);
  });

  it('queues a blind answer for a high-tier item solved offline', async () => {
    const store = await openStore();
    await store.queueSolve({ itemId: 7, answer: 'C', queuedAt: new Date('2026-08-09T10:00:00Z') });

    expect(await store.getPendingSolves()).toEqual([
      { itemId: 7, answer: 'C', queuedAt: new Date('2026-08-09T10:00:00Z') },
    ]);
    expect(await store.countPendingSolves()).toBe(1);
  });

  it('removes a queued solve once it has synced', async () => {
    const store = await openStore();
    await store.queueSolve({ itemId: 7, answer: 'C', queuedAt: new Date() });
    await store.removePendingSolve(7);

    expect(await store.getPendingSolves()).toEqual([]);
  });
});

describe('persistence across handles on the same database', () => {
  it('a second store opened against the same name sees what the first wrote', async () => {
    const name = freshDbName();
    const first = await createOfflineStore(name);
    await first.cacheItems([{ item: makeItem(1), reveal: null, cachedAt: new Date() }]);
    first.close();

    const second = await createOfflineStore(name);
    openStores.push(second);
    expect(await second.countCachedItems()).toBe(1);
  });
});
