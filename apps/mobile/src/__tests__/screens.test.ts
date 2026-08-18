import { describe, expect, it } from 'vitest';

/**
 * Mirrors the old App.test.ts's scope exactly: "is this a function" /
 * "does this module import cleanly" checks, nothing more. apps/mobile's
 * stub-based test setup (react-native, expo-router and expo-sqlite are all
 * aliased to shape-only no-op stubs, see vitest.config.mts) cannot render
 * or exercise real behaviour -- every actual decision this app makes
 * already lives in, and is fully tested by, packages/shared
 * (exam-timer.ts, mock-session-reducer.ts, scoring.ts) and packages/db
 * (session-repository.ts). See CLAUDE.md rule 7 and the mobile-UI phase's
 * build-log entry for why the orchestrator hook and screens are verified
 * manually on-device instead.
 */
describe('screens import cleanly and export a component function', () => {
  it('_layout', async () => {
    const { default: RootLayout } = await import('../app/_layout');
    expect(typeof RootLayout).toBe('function');
  });

  it('index (Home)', async () => {
    const { default: Home } = await import('../app/index');
    expect(typeof Home).toBe('function');
  });

  it('mock-session', async () => {
    const { default: MockSessionScreen } = await import('../app/mock-session');
    expect(typeof MockSessionScreen).toBe('function');
  });

  it('results', async () => {
    const { default: ResultsScreen } = await import('../app/results');
    expect(typeof ResultsScreen).toBe('function');
  });

  it('register', async () => {
    const { default: RegisterScreen } = await import('../app/register');
    expect(typeof RegisterScreen).toBe('function');
  });

  it('practice (subject picker)', async () => {
    const { default: PracticeSubjectsScreen } = await import('../app/practice');
    expect(typeof PracticeSubjectsScreen).toBe('function');
  });

  it('practice-session', async () => {
    const { default: PracticeSessionScreen } = await import('../app/practice-session');
    expect(typeof PracticeSessionScreen).toBe('function');
  });
});

describe('supporting modules import cleanly', () => {
  it('useMockSession', async () => {
    const { useMockSession } = await import('../hooks/useMockSession');
    expect(typeof useMockSession).toBe('function');
  });

  it('usePractice', async () => {
    const { usePractice } = await import('../hooks/usePractice');
    expect(typeof usePractice).toBe('function');
  });

  it('database', async () => {
    const database = await import('../lib/database');
    expect(typeof database.startLocalSession).toBe('function');
    expect(typeof database.recordLocalProgressEvent).toBe('function');
    expect(typeof database.loadLocalSessionForResume).toBe('function');
    expect(typeof database.loadScoringAttempts).toBe('function');
    expect(typeof database.endLocalSession).toBe('function');
    expect(typeof database.updateLastObservedAt).toBe('function');
    expect(typeof database.saveLocalCandidate).toBe('function');
    expect(typeof database.loadLocalCandidate).toBe('function');
    expect(typeof database.loadSessionsNeedingSync).toBe('function');
    expect(typeof database.loadLocalProgressEvents).toBe('function');
    expect(typeof database.markSessionSynced).toBe('function');
    expect(typeof database.saveActiveExamConfigId).toBe('function');
    expect(typeof database.loadActiveExamConfigId).toBe('function');
    expect(typeof database.loadLocalContentVersion).toBe('function');
    expect(typeof database.saveSubjectPack).toBe('function');
    expect(typeof database.loadDownloadedSubjects).toBe('function');
    expect(typeof database.loadLocalItems).toBe('function');
    expect(typeof database.findLocalItem).toBe('function');
  });

  it('candidate-api-client', async () => {
    const client = await import('../lib/candidate-api-client');
    expect(typeof client.registerCandidate).toBe('function');
    expect(typeof client.startCandidateSession).toBe('function');
    expect(typeof client.recordCandidateAttempt).toBe('function');
    expect(typeof client.endCandidateSession).toBe('function');
  });

  it('content-pack-api-client', async () => {
    const client = await import('../lib/content-pack-api-client');
    expect(typeof client.listAvailablePacks).toBe('function');
    expect(typeof client.downloadPack).toBe('function');
  });

  it('sync', async () => {
    const sync = await import('../lib/sync');
    expect(typeof sync.ensureRegistered).toBe('function');
    expect(typeof sync.syncPendingSessions).toBe('function');
  });

  it('content-sync', async () => {
    const contentSync = await import('../lib/content-sync');
    expect(typeof contentSync.downloadAvailablePacks).toBe('function');
  });

  it('demo-fixture: 4 subjects x 5 items, matching the demo ExamConfig', async () => {
    const { DEMO_ITEMS, DEMO_EXAM_CONFIG, DEMO_SUBJECTS, findDemoItem } = await import('../lib/demo-fixture');
    expect(DEMO_ITEMS).toHaveLength(20);
    expect(DEMO_SUBJECTS).toHaveLength(4);
    expect(DEMO_EXAM_CONFIG.totalMarks).toBe(100);
    expect(DEMO_EXAM_CONFIG.subjects).toHaveLength(4);
    for (const item of DEMO_ITEMS) {
      expect(item.options.filter((option) => option.isCorrect)).toHaveLength(1);
      expect(findDemoItem(item.itemId)).toBe(item);
    }
    expect(() => findDemoItem(9999)).toThrow(/no demo item/);
  });
});
