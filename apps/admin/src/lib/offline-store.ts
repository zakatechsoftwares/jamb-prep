import type { OptionLabel, RevealResult, ReviewQueueItem } from '@jamb/shared';
import type { DecideRequestInput } from './api-client';

/**
 * The offline layer's local persistence (plan 7.9 "offline capable", 8.3's
 * sync design). IndexedDB rather than anything server-reachable, so the
 * workspace stays usable with genuinely no connection.
 *
 * A cached item's `reveal` is `null` for a high-tier item by design, not an
 * omission: prefetching the key would let anti-anchoring rest on the
 * reducer remembering not to render data it already has, rather than on
 * the server never having released it. Reveal for a high-tier item stays
 * online-only — see the prefetch orchestration that populates this store.
 */
export interface CachedQueueItem {
  item: ReviewQueueItem;
  reveal: RevealResult | null;
  cachedAt: Date;
}

/** A decision made (online or offline) and not yet confirmed uploaded. */
export interface PendingDecision {
  idempotencyKey: string;
  itemId: number;
  input: DecideRequestInput;
  queuedAt: Date;
}

/**
 * A blind answer for a high-tier item, submitted offline and not yet
 * confirmed uploaded. `submitSolve` has no idempotency key of its own — its
 * own uniqueness comes from `reviewer_answer IS NULL` on the server, so a
 * retried upload either records the answer or is told it already did.
 */
export interface PendingSolve {
  itemId: number;
  answer: OptionLabel;
  queuedAt: Date;
}

export interface OfflineStore {
  cacheItems(items: CachedQueueItem[]): Promise<void>;
  getCachedItems(): Promise<CachedQueueItem[]>;
  removeCachedItem(itemId: number): Promise<void>;
  countCachedItems(): Promise<number>;
  /** The soonest claimExpiresAt across every cached item, or null if none are cached. */
  nextClaimExpiry(): Promise<Date | null>;

  queueDecision(decision: PendingDecision): Promise<void>;
  getPendingDecisions(): Promise<PendingDecision[]>;
  removePendingDecision(idempotencyKey: string): Promise<void>;
  countPendingDecisions(): Promise<number>;

  queueSolve(solve: PendingSolve): Promise<void>;
  getPendingSolves(): Promise<PendingSolve[]>;
  removePendingSolve(itemId: number): Promise<void>;
  countPendingSolves(): Promise<number>;

  close(): void;
}

const CACHED_ITEMS_STORE = 'cachedItems';
const PENDING_DECISIONS_STORE = 'pendingDecisions';
const PENDING_SOLVES_STORE = 'pendingSolves';
const DB_VERSION = 1;

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHED_ITEMS_STORE)) {
        db.createObjectStore(CACHED_ITEMS_STORE, { keyPath: 'item.itemId' });
      }
      if (!db.objectStoreNames.contains(PENDING_DECISIONS_STORE)) {
        db.createObjectStore(PENDING_DECISIONS_STORE, { keyPath: 'idempotencyKey' });
      }
      if (!db.objectStoreNames.contains(PENDING_SOLVES_STORE)) {
        db.createObjectStore(PENDING_SOLVES_STORE, { keyPath: 'itemId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function createOfflineStore(dbName: string): Promise<OfflineStore> {
  const db = await openDatabase(dbName);

  async function putAll(storeName: string, rows: unknown[]): Promise<void> {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const row of rows) {
      store.put(row);
    }
    await txDone(tx);
  }

  async function getAll<T>(storeName: string): Promise<T[]> {
    const tx = db.transaction(storeName, 'readonly');
    const result = await requestToPromise(tx.objectStore(storeName).getAll());
    return result as T[];
  }

  async function remove(storeName: string, key: IDBValidKey): Promise<void> {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    await txDone(tx);
  }

  async function count(storeName: string): Promise<number> {
    const tx = db.transaction(storeName, 'readonly');
    return requestToPromise(tx.objectStore(storeName).count());
  }

  return {
    async cacheItems(items) {
      await putAll(CACHED_ITEMS_STORE, items);
    },

    async getCachedItems() {
      return getAll<CachedQueueItem>(CACHED_ITEMS_STORE);
    },

    async removeCachedItem(itemId) {
      await remove(CACHED_ITEMS_STORE, itemId);
    },

    async countCachedItems() {
      return count(CACHED_ITEMS_STORE);
    },

    async nextClaimExpiry() {
      const items = await getAll<CachedQueueItem>(CACHED_ITEMS_STORE);
      if (items.length === 0) {
        return null;
      }
      return items.reduce<Date>(
        (earliest, entry) => (entry.item.claimExpiresAt < earliest ? entry.item.claimExpiresAt : earliest),
        items[0]!.item.claimExpiresAt,
      );
    },

    async queueDecision(decision) {
      await putAll(PENDING_DECISIONS_STORE, [decision]);
    },

    async getPendingDecisions() {
      return getAll<PendingDecision>(PENDING_DECISIONS_STORE);
    },

    async removePendingDecision(idempotencyKey) {
      await remove(PENDING_DECISIONS_STORE, idempotencyKey);
    },

    async countPendingDecisions() {
      return count(PENDING_DECISIONS_STORE);
    },

    async queueSolve(solve) {
      await putAll(PENDING_SOLVES_STORE, [solve]);
    },

    async getPendingSolves() {
      return getAll<PendingSolve>(PENDING_SOLVES_STORE);
    },

    async removePendingSolve(itemId) {
      await remove(PENDING_SOLVES_STORE, itemId);
    },

    async countPendingSolves() {
      return count(PENDING_SOLVES_STORE);
    },

    close() {
      db.close();
    },
  };
}
