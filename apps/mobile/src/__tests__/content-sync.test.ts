import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Real behavioural coverage for content-sync.ts, mirroring sync.test.ts's
 * pattern: `../lib/database` and `../lib/content-pack-api-client` are
 * mocked rather than injected, matching how this app has no DI layer
 * anywhere.
 */

vi.mock('../lib/database', () => ({
  loadLocalCandidate: vi.fn(),
  loadLocalContentVersion: vi.fn(),
  saveActiveExamConfigId: vi.fn(),
  saveSubjectPack: vi.fn(),
}));

vi.mock('../lib/content-pack-api-client', () => ({
  listAvailablePacks: vi.fn(),
  downloadPack: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const CANDIDATE = { userId: 1, token: 'tok', deviceId: 'device-1' };

describe('downloadAvailablePacks', () => {
  it('does nothing when no candidate is registered yet', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/content-pack-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue(null);

    const { downloadAvailablePacks } = await import('../lib/content-sync');
    await downloadAvailablePacks();

    expect(apiClient.listAvailablePacks).not.toHaveBeenCalled();
  });

  it('saves the active exam config id, and downloads only a subject whose version changed', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/content-pack-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue(CANDIDATE);
    vi.mocked(apiClient.listAvailablePacks).mockResolvedValue({
      activeExamConfigId: 7,
      packs: [
        { subjectId: 1, subjectName: 'Use of English', version: 'v2', itemCount: 42 },
        { subjectId: 3, subjectName: 'Biology', version: 'v1', itemCount: 52 },
      ],
    });
    vi.mocked(database.loadLocalContentVersion).mockImplementation(async (subjectId: number) =>
      subjectId === 3 ? 'v1' : 'v1-old',
    );
    const downloadedPack = { subjectId: 1, subjectName: 'Use of English', version: 'v2', items: [] };
    vi.mocked(apiClient.downloadPack).mockResolvedValue(downloadedPack);

    const { downloadAvailablePacks } = await import('../lib/content-sync');
    await downloadAvailablePacks();

    expect(database.saveActiveExamConfigId).toHaveBeenCalledWith(7);
    expect(apiClient.downloadPack).toHaveBeenCalledTimes(1);
    expect(apiClient.downloadPack).toHaveBeenCalledWith('tok', 1);
    expect(database.saveSubjectPack).toHaveBeenCalledWith(downloadedPack);
  });

  it('does not save an exam config id when none is active yet', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/content-pack-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue(CANDIDATE);
    vi.mocked(apiClient.listAvailablePacks).mockResolvedValue({ activeExamConfigId: null, packs: [] });

    const { downloadAvailablePacks } = await import('../lib/content-sync');
    await downloadAvailablePacks();

    expect(database.saveActiveExamConfigId).not.toHaveBeenCalled();
  });

  it('continues to the next subject when one fails to download, and never throws', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/content-pack-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue(CANDIDATE);
    vi.mocked(apiClient.listAvailablePacks).mockResolvedValue({
      activeExamConfigId: 7,
      packs: [
        { subjectId: 1, subjectName: 'Use of English', version: 'v2', itemCount: 42 },
        { subjectId: 3, subjectName: 'Biology', version: 'v2', itemCount: 52 },
      ],
    });
    vi.mocked(database.loadLocalContentVersion).mockResolvedValue('v1');
    vi.mocked(apiClient.downloadPack).mockImplementation(async (_token: string, subjectId: number) => {
      if (subjectId === 1) {
        throw new Error('network error');
      }
      return { subjectId, subjectName: 'Biology', version: 'v2', items: [] };
    });

    const { downloadAvailablePacks } = await import('../lib/content-sync');
    await expect(downloadAvailablePacks()).resolves.toBeUndefined();

    expect(database.saveSubjectPack).toHaveBeenCalledTimes(1);
    expect(database.saveSubjectPack).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 3 }),
    );
  });

  it('never throws when the manifest fetch itself fails', async () => {
    const database = await import('../lib/database');
    const apiClient = await import('../lib/content-pack-api-client');
    vi.mocked(database.loadLocalCandidate).mockResolvedValue(CANDIDATE);
    vi.mocked(apiClient.listAvailablePacks).mockRejectedValue(new Error('network error'));

    const { downloadAvailablePacks } = await import('../lib/content-sync');
    await expect(downloadAvailablePacks()).resolves.toBeUndefined();
  });
});
