import type { SelectSubjectCombinationInput, SubjectCombinationOption } from '@jamb/shared';

/**
 * A thin fetch wrapper for the two `/candidate/subject-combination*` routes
 * (onboarding). Mirrors `candidate-api-client.ts` exactly.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

export async function listSubjectCombinations(
  token: string,
): Promise<{ combinations: SubjectCombinationOption[] }> {
  const response = await fetch(`${BASE_URL}/candidate/subject-combinations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET /candidate/subject-combinations failed with status ${response.status}`);
  }
  return (await response.json()) as { combinations: SubjectCombinationOption[] };
}

export async function selectSubjectCombination(
  token: string,
  input: SelectSubjectCombinationInput,
): Promise<void> {
  const response = await fetch(`${BASE_URL}/candidate/subject-combination`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`POST /candidate/subject-combination failed with status ${response.status}`);
  }
}
