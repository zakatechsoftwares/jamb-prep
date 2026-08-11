import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logRawResponse } from './raw-response-logger';

describe('logRawResponse', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'item-gen-raw-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the raw response as pretty-printed JSON and returns the path', async () => {
    const filePath = await logRawResponse(dir, {
      callType: 'authoring',
      objectiveId: 42,
      timestamp: new Date('2026-08-10T12:00:00.000Z'),
      rawResponse: { hello: 'world' },
    });

    const contents = await readFile(filePath, 'utf8');
    expect(JSON.parse(contents)).toEqual({ hello: 'world' });
    expect(path.dirname(filePath)).toBe(dir);
  });

  it('names the file with the objective id and call type, distinguishable across calls', async () => {
    const authoringPath = await logRawResponse(dir, {
      callType: 'authoring',
      objectiveId: 42,
      timestamp: new Date('2026-08-10T12:00:00.000Z'),
      rawResponse: {},
    });
    const solvePath = await logRawResponse(dir, {
      callType: 'independent_solve',
      objectiveId: 42,
      timestamp: new Date('2026-08-10T12:00:01.000Z'),
      rawResponse: {},
    });

    expect(authoringPath).toContain('objective-42-authoring');
    expect(solvePath).toContain('objective-42-independent_solve');
    expect(authoringPath).not.toBe(solvePath);
  });

  it('creates the log directory if it does not exist yet', async () => {
    const nested = path.join(dir, 'nested', 'deeper');
    const filePath = await logRawResponse(nested, {
      callType: 'embedding',
      objectiveId: 1,
      timestamp: new Date(),
      rawResponse: {},
    });

    expect(await readFile(filePath, 'utf8')).toBeTruthy();
  });
});
