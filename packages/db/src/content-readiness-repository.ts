import type { PoolClient } from 'pg';
import type { SubjectCombinationReadiness } from '@jamb/shared';
import { computeSubjectCombinationReadiness } from '@jamb/shared';
import { listSubjectCombinations } from './subject-combination-repository';
import { loadActiveExamConfigId, loadActiveExamConfigRules } from './exam-config-repository';
import { approvedItemCountBySubject } from './content-dashboard-repository';

/**
 * Per-combination Mock-exam readiness (content-readiness-policy.ts).
 * Returns `[]` when no `exam_configs` row is active yet — there is no
 * blueprint to be ready against, and the content-lead dashboard should
 * degrade to "nothing to report" here rather than fail the whole dashboard.
 * `loadActiveExamConfigRules` itself throws on no active config, matching
 * `loadExamConfigForUser`'s existing behaviour — checking
 * `loadActiveExamConfigId` first, as its own docstring recommends, is what
 * keeps that throw out of this call path.
 */
export async function subjectCombinationReadiness(
  client: PoolClient,
): Promise<SubjectCombinationReadiness[]> {
  const activeExamConfigId = await loadActiveExamConfigId(client);
  if (activeExamConfigId === null) {
    return [];
  }

  const combinations = await listSubjectCombinations(client);
  const { rules } = await loadActiveExamConfigRules(client);

  const compulsoryRule = rules.find((rule) => rule.role === 'compulsory');
  const electiveRule = rules.find((rule) => rule.role === 'elective');
  if (!compulsoryRule || !electiveRule) {
    throw new Error(
      `subjectCombinationReadiness: exam config ${activeExamConfigId} is missing a 'compulsory' or 'elective' rule — cannot resolve required item counts`,
    );
  }

  const approvedCounts = await approvedItemCountBySubject(client);
  const approvedCountBySubjectId = new Map(approvedCounts.map((row) => [row.subjectId, row.approvedCount]));

  return computeSubjectCombinationReadiness(
    combinations,
    { compulsory: compulsoryRule.itemsPerSubject, elective: electiveRule.itemsPerSubject },
    approvedCountBySubjectId,
  );
}
