import type { SubjectPack, SubjectPackManifest } from '@jamb/shared';

/**
 * A thin fetch wrapper for the two `/candidate/content-packs*` routes
 * (content sync, plan 8.3's server-to-device half). Mirrors
 * `candidate-api-client.ts` exactly, including its `EXPO_PUBLIC_API_BASE_URL`
 * convention.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

async function getJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET ${path} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export function listAvailablePacks(token: string): Promise<SubjectPackManifest> {
  return getJson('/candidate/content-packs', token);
}

export function downloadPack(token: string, subjectId: number): Promise<SubjectPack> {
  return getJson(`/candidate/content-packs/${subjectId}`, token);
}
