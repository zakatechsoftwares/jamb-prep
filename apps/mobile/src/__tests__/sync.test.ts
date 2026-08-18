import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Real behavioural coverage for sync.ts -- unlike screens.test.ts's
 * import-shape checks (this app's testing ceiling until now, see its own
 * doc comment), this exercises the orchestration itself: register-once,
 * retry-whole-session-on-failure, best-effort/never-throws. `../lib/database`
 * and `../lib/candidate-api-client` are mocked rather than injected,
 * matching how useMockSession.ts already imports database.ts directly
 * with no DI layer anywhere in this app.
 */

vi.mock('../lib/database', () => ({
  loadLocalCandidate: vi.fn(),
  saveLocalCandidate: vi.fn(),
  loadSessionsNeedingSync: vi.fn(),
  loadLocalProgressEvents: vi.fn(),
  markSessionSynced: vi.fn(),
}));

vi.mock('../lib/candidate-api-client', () => ({
  registerCandidate: vi.fn(),
  startCandidateSession: vi.fn(),
  recordCandidateAttempt: vi.fn(),
  endCandidateSession: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('ensureRegistered', () => {
  it('does nothing if a candidate is already registered', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/candidate-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue({
      userId: 1,
      token: 'tok',
      deviceId: 'device-1',
    });

    const { ensureRegistered } = await import('../lib/sync');
    await ensureRegistered('Ada', '0801', 2027);

    expect(apiClient.registerCandidate).not.toHaveBeenCalled();
    expect(database.saveLocalCandidate).not.toHaveBeenCalled();
  });

  it('registers and saves the result when no candidate exists yet', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/candidate-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue(null);
    vi.mocked(apiClient.registerCandidate).mockResolvedValue({ token: 'new-tok', userId: 42 });

    const { ensureRegistered } = await import('../lib/sync');
    await ensureRegistered('Ada', '0801', 2027);

    expect(apiClient.registerCandidate).toHaveBeenCalledWith({
      fullName: 'Ada',
      phone: '0801',
      examYear: 2027,
    });
    expect(database.saveLocalCandidate).toHaveBeenCalledWith(42, 'new-tok', expect.any(String));
  });
});

describe('syncPendingSessions', () => {
  it('does nothing when no candidate is registered yet', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/candidate-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue(null);

    const { syncPendingSessions } = await import('../lib/sync');
    await syncPendingSessions();

    expect(database.loadSessionsNeedingSync).not.toHaveBeenCalled();
    expect(apiClient.startCandidateSession).not.toHaveBeenCalled();
  });

  it('uploads a finished session end to end: start, every answered attempt, end, then marks synced', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/candidate-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue({
      userId: 1,
      token: 'tok',
      deviceId: 'device-1',
    });
    const startedAt = new Date('2026-08-19T08:00:00.000Z');
    const endedAt = new Date('2026-08-19T08:10:00.000Z');
    vi.mocked(database.loadSessionsNeedingSync).mockResolvedValue([
      {
        sessionId: 1,
        startedAt,
        endedAt,
        clientSessionId: 'client-1',
        examConfigId: 7,
        mode: 'mock',
      },
    ]);
    vi.mocked(database.loadLocalProgressEvents).mockResolvedValue([
      {
        itemId: 1,
        chosenOption: 'A',
        flagged: false,
        occurredAt: new Date('2026-08-19T08:00:30.000Z'),
        idempotencyKey: 'attempt-1',
      },
    ]);
    vi.mocked(apiClient.startCandidateSession).mockResolvedValue({ sessionId: 999 });
    vi.mocked(apiClient.recordCandidateAttempt).mockResolvedValue({ attemptId: 1 });
    vi.mocked(apiClient.endCandidateSession).mockResolvedValue({
      subjectScores: [],
      aggregateScore: 0,
      aggregateMaxMarks: 0,
    });

    const { syncPendingSessions } = await import('../lib/sync');
    await syncPendingSessions();

    expect(apiClient.startCandidateSession).toHaveBeenCalledWith('tok', {
      clientSessionId: 'client-1',
      examConfigId: 7,
      mode: 'mock',
      deviceId: 'device-1',
      startedAt: startedAt.toISOString(),
    });
    expect(apiClient.recordCandidateAttempt).toHaveBeenCalledWith(
      'tok',
      999,
      expect.objectContaining({ itemId: 1, chosenOption: 'A', idempotencyKey: 'attempt-1' }),
    );
    expect(apiClient.endCandidateSession).toHaveBeenCalledWith('tok', 999, {
      endedAt: endedAt.toISOString(),
    });
    expect(database.markSessionSynced).toHaveBeenCalledWith(1, 999);
  });

  it('leaves the session unsynced and does not throw when the upload fails partway', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/candidate-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue({
      userId: 1,
      token: 'tok',
      deviceId: 'device-1',
    });
    vi.mocked(database.loadSessionsNeedingSync).mockResolvedValue([
      {
        sessionId: 1,
        startedAt: new Date('2026-08-19T08:00:00.000Z'),
        endedAt: new Date('2026-08-19T08:10:00.000Z'),
        clientSessionId: 'client-1',
        examConfigId: 0, // the demo fixture's own sentinel -- expected to fail server-side
        mode: 'mock',
      },
    ]);
    vi.mocked(apiClient.startCandidateSession).mockRejectedValue(new Error('network error'));

    const { syncPendingSessions } = await import('../lib/sync');
    await expect(syncPendingSessions()).resolves.toBeUndefined();

    expect(database.markSessionSynced).not.toHaveBeenCalled();
  });
});
