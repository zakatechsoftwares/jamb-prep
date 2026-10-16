import { describe, expect, it } from 'vitest';
import { decideCandidateSignOut } from './candidate-sign-out-policy';

const DEMO_CONFIG_ID = 0;

describe('decideCandidateSignOut', () => {
  it('allows sign-out when no mock is open and nothing is waiting to upload', () => {
    expect(
      decideCandidateSignOut({
        hasOpenMockSession: false,
        unsyncedSessionExamConfigIds: [],
        unsyncableExamConfigId: DEMO_CONFIG_ID,
      }),
    ).toEqual({ canSignOut: true });
  });

  it('refuses while a mock exam is still open', () => {
    expect(
      decideCandidateSignOut({
        hasOpenMockSession: true,
        unsyncedSessionExamConfigIds: [],
        unsyncableExamConfigId: DEMO_CONFIG_ID,
      }),
    ).toEqual({ canSignOut: false, reason: 'mock_in_progress' });
  });

  it('refuses while real sessions are waiting to upload, saying how many', () => {
    expect(
      decideCandidateSignOut({
        hasOpenMockSession: false,
        unsyncedSessionExamConfigIds: [7, 7],
        unsyncableExamConfigId: DEMO_CONFIG_ID,
      }),
    ).toEqual({ canSignOut: false, reason: 'unsynced_sessions', unsyncedCount: 2 });
  });

  it('reports an open mock first — finishing it is the step that comes before uploading', () => {
    expect(
      decideCandidateSignOut({
        hasOpenMockSession: true,
        unsyncedSessionExamConfigIds: [7],
        unsyncableExamConfigId: DEMO_CONFIG_ID,
      }),
    ).toEqual({ canSignOut: false, reason: 'mock_in_progress' });
  });

  it('ignores demo sessions, which can never upload and so can never be credited to anyone', () => {
    expect(
      decideCandidateSignOut({
        hasOpenMockSession: false,
        unsyncedSessionExamConfigIds: [DEMO_CONFIG_ID, DEMO_CONFIG_ID],
        unsyncableExamConfigId: DEMO_CONFIG_ID,
      }),
    ).toEqual({ canSignOut: true });
  });

  it('counts only the real sessions when demo and real are both waiting', () => {
    expect(
      decideCandidateSignOut({
        hasOpenMockSession: false,
        unsyncedSessionExamConfigIds: [DEMO_CONFIG_ID, 7, DEMO_CONFIG_ID],
        unsyncableExamConfigId: DEMO_CONFIG_ID,
      }),
    ).toEqual({ canSignOut: false, reason: 'unsynced_sessions', unsyncedCount: 1 });
  });

  it('throws on an exam config id that is not a whole number', () => {
    for (const bad of [1.5, Number.NaN, -1]) {
      expect(() =>
        decideCandidateSignOut({
          hasOpenMockSession: false,
          unsyncedSessionExamConfigIds: [bad],
          unsyncableExamConfigId: DEMO_CONFIG_ID,
        }),
      ).toThrow(/exam config id/);
    }
    expect(() =>
      decideCandidateSignOut({
        hasOpenMockSession: false,
        unsyncedSessionExamConfigIds: [],
        unsyncableExamConfigId: 0.5,
      }),
    ).toThrow(/exam config id/);
  });
});
