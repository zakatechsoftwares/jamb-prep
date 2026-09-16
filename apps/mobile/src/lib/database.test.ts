import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression test for the real bug this session's device testing surfaced:
 * a cold start fires several getDb()-touching functions concurrently
 * (_layout.tsx's syncPendingSessions/downloadAvailablePacks, plus whatever
 * screen is current -- e.g. useMockSession's own resume check), and the
 * original `if (!db)` check-then-open guard let two callers both see no
 * connection yet and each open their own, corrupting the shared `db`
 * variable and producing a real NativeDatabase.prepareAsync
 * NullPointerException on Android. vi.resetModules() per test gives each
 * one a fresh, unopened module instance, matching a real cold start.
 */
describe('getDb concurrency', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('opens the underlying database exactly once when multiple callers race on first access', async () => {
    const sqlite = await import('expo-sqlite');
    const openSpy = vi.spyOn(sqlite, 'openDatabaseAsync');

    const database = await import('./database');

    // Two independent exported functions, fired without awaiting in
    // between -- the same shape as the real bug: multiple unrelated
    // callers hitting getDb() before the first open has resolved.
    const [candidate, examConfigId] = await Promise.all([
      database.loadLocalCandidate(),
      database.loadActiveExamConfigId(),
    ]);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(candidate).toBeNull();
    expect(examConfigId).toBeNull();
  });

  it('lets a later call retry after a failed open, rather than rejecting forever', async () => {
    const sqlite = await import('expo-sqlite');
    const openSpy = vi.spyOn(sqlite, 'openDatabaseAsync').mockRejectedValueOnce(new Error('disk not ready'));

    const database = await import('./database');

    await expect(database.loadLocalCandidate()).rejects.toThrow('disk not ready');
    await expect(database.loadLocalCandidate()).resolves.toBeNull();

    expect(openSpy).toHaveBeenCalledTimes(2);
  });
});
