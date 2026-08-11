import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Every raw API response, logged to disk for audit (BUILD constraint:
 * "Log every raw API response to disk for audit"). `generated-items-raw/`
 * is already in the repo's `.gitignore` — this is the directory that entry
 * anticipated.
 */
export const DEFAULT_LOG_DIR = 'generated-items-raw';

export type RawResponseCallType = 'authoring' | 'independent_solve' | 'embedding';

export interface RawResponseLogEntry {
  callType: RawResponseCallType;
  objectiveId: number;
  timestamp: Date;
  rawResponse: unknown;
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[:.]/g, '-');
}

/** Returns the path the entry was written to. */
export async function logRawResponse(logDir: string, entry: RawResponseLogEntry): Promise<string> {
  await mkdir(logDir, { recursive: true });

  const filename = `${sanitizeForFilename(entry.timestamp.toISOString())}-objective-${entry.objectiveId}-${entry.callType}.json`;
  const filePath = path.join(logDir, filename);

  await writeFile(filePath, JSON.stringify(entry.rawResponse, null, 2), 'utf8');
  return filePath;
}
