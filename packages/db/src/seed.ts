import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTION_LABELS, type OptionLabel } from '@jamb/shared';
import { firstRow } from './first-row';
import { pool } from './client';
import { deriveRiskTier } from './risk-tier';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedItemsPath = path.resolve(__dirname, '../../../docs/jamb-seed-items.json');

interface SeedItem {
  id: string;
  subject: string;
  topic: string;
  subtopic: string;
  objective: string;
  cognitive_level: string;
  author_difficulty: number;
  expected_time_seconds: number;
  // Optional in the seed file: absent means "no calculation", which is
  // correct for the current seed set. Generated batches set it explicitly.
  contains_calculation?: boolean;
  stem: string;
  options: Record<OptionLabel, string>;
  correct_option: OptionLabel;
  explanation: string;
  method_steps: string[];
}

interface SeedFile {
  items: SeedItem[];
}

async function upsertSubject(name: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO subjects (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name],
  );
  return firstRow(result).id;
}

async function upsertTopic(subjectId: number, name: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO topics (subject_id, name) VALUES ($1, $2)
     ON CONFLICT (subject_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [subjectId, name],
  );
  return firstRow(result).id;
}

async function upsertSubtopic(topicId: number, name: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO subtopics (topic_id, name) VALUES ($1, $2)
     ON CONFLICT (topic_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [topicId, name],
  );
  return firstRow(result).id;
}

async function upsertObjective(subtopicId: number, description: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO objectives (subtopic_id, description) VALUES ($1, $2)
     ON CONFLICT (subtopic_id, description) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
    [subtopicId, description],
  );
  return firstRow(result).id;
}

interface SyllabusIds {
  subjectId: number;
  topicId: number;
  subtopicId: number;
  objectiveId: number;
}

async function upsertSyllabusPath(item: SeedItem): Promise<SyllabusIds> {
  const subjectId = await upsertSubject(item.subject);
  const topicId = await upsertTopic(subjectId, item.topic);
  const subtopicId = await upsertSubtopic(topicId, item.subtopic);
  const objectiveId = await upsertObjective(subtopicId, item.objective);
  return { subjectId, topicId, subtopicId, objectiveId };
}

async function upsertItem(item: SeedItem, ids: SyllabusIds): Promise<number> {
  const provenance = { source: 'docs/jamb-seed-items.json', source_id: item.id };

  const result = await pool.query<{ id: number }>(
    `INSERT INTO items (
       subject_id, topic_id, subtopic_id, objective_id,
       stem, explanation, method_steps, cognitive_level,
       author_difficulty, expected_time_seconds, provenance,
       risk_tier, status, external_ref
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'generated',$13)
     ON CONFLICT (external_ref) DO UPDATE SET
       subject_id = EXCLUDED.subject_id,
       topic_id = EXCLUDED.topic_id,
       subtopic_id = EXCLUDED.subtopic_id,
       objective_id = EXCLUDED.objective_id,
       stem = EXCLUDED.stem,
       explanation = EXCLUDED.explanation,
       method_steps = EXCLUDED.method_steps,
       cognitive_level = EXCLUDED.cognitive_level,
       author_difficulty = EXCLUDED.author_difficulty,
       expected_time_seconds = EXCLUDED.expected_time_seconds,
       provenance = EXCLUDED.provenance,
       risk_tier = EXCLUDED.risk_tier
     RETURNING id`,
    [
      ids.subjectId,
      ids.topicId,
      ids.subtopicId,
      ids.objectiveId,
      item.stem,
      item.explanation,
      item.method_steps,
      item.cognitive_level,
      item.author_difficulty,
      item.expected_time_seconds,
      JSON.stringify(provenance),
      deriveRiskTier(item.subject, item.contains_calculation ?? false),
      item.id,
    ],
  );

  return firstRow(result).id;
}

async function upsertItemOptions(itemId: number, item: SeedItem): Promise<void> {
  for (const label of OPTION_LABELS) {
    await pool.query(
      `INSERT INTO item_options (item_id, label, option_text, is_correct)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (item_id, label) DO UPDATE SET
         option_text = EXCLUDED.option_text,
         is_correct = EXCLUDED.is_correct`,
      [itemId, label, item.options[label], label === item.correct_option],
    );
  }
}

async function seedItems(items: SeedItem[]): Promise<void> {
  for (const item of items) {
    const syllabusIds = await upsertSyllabusPath(item);
    const itemId = await upsertItem(item, syllabusIds);
    await upsertItemOptions(itemId, item);
  }
}

async function seed2026ExamConfig(): Promise<void> {
  const configResult = await pool.query<{ id: number }>(
    `INSERT INTO exam_configs (exam_year, version, total_duration_minutes, total_marks, negative_marking, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (exam_year, version) DO UPDATE SET
       total_duration_minutes = EXCLUDED.total_duration_minutes,
       total_marks = EXCLUDED.total_marks,
       negative_marking = EXCLUDED.negative_marking,
       is_active = EXCLUDED.is_active
     RETURNING id`,
    [2026, 1, 120, 400, false, true],
  );
  const examConfigId = firstRow(configResult).id;

  const englishSubjectId = await upsertSubject('Use of English');

  const rules: Array<{
    role: 'compulsory' | 'elective';
    subjectId: number | null;
    slotCount: number;
    itemsPerSubject: number;
    marksPerSubject: number;
  }> = [
    {
      role: 'compulsory',
      subjectId: englishSubjectId,
      slotCount: 1,
      itemsPerSubject: 60,
      marksPerSubject: 100,
    },
    { role: 'elective', subjectId: null, slotCount: 3, itemsPerSubject: 40, marksPerSubject: 100 },
  ];

  for (const rule of rules) {
    await pool.query(
      `INSERT INTO exam_config_subject_rules (
         exam_config_id, role, subject_id, slot_count, items_per_subject, marks_per_subject
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (exam_config_id, role) DO UPDATE SET
         subject_id = EXCLUDED.subject_id,
         slot_count = EXCLUDED.slot_count,
         items_per_subject = EXCLUDED.items_per_subject,
         marks_per_subject = EXCLUDED.marks_per_subject`,
      [
        examConfigId,
        rule.role,
        rule.subjectId,
        rule.slotCount,
        rule.itemsPerSubject,
        rule.marksPerSubject,
      ],
    );
  }
}

async function upsertSubjectCombination(courseName: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO subject_combinations (course_name) VALUES ($1)
     ON CONFLICT (course_name) DO UPDATE SET course_name = EXCLUDED.course_name
     RETURNING id`,
    [courseName],
  );
  return firstRow(result).id;
}

async function upsertSubjectCombinationSubject(
  subjectCombinationId: number,
  subjectId: number,
  role: 'compulsory' | 'elective',
): Promise<void> {
  await pool.query(
    `INSERT INTO subject_combination_subjects (subject_combination_id, subject_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (subject_combination_id, subject_id) DO UPDATE SET role = EXCLUDED.role`,
    [subjectCombinationId, subjectId, role],
  );
}

interface SubjectCombinationSeed {
  courseName: string;
  compulsorySubject: string;
  electiveSubjects: [string, string, string];
}

/**
 * Real, standard JAMB elective sets, using only the 5 subjects this repo
 * has seeded so far (`Use of English`, `Mathematics`, `Physics`,
 * `Chemistry`, `Biology`) -- no subject is invented here. This does not,
 * by itself, make any combination content-complete: only English and
 * Biology have approved items today (content sync's own finding), so
 * every combination below is still missing at least one elective's worth
 * of reviewed content. That is a separate, disclosed gap this seed data
 * does not attempt to paper over -- see CLAUDE.md's "Subject-combination
 * onboarding" section.
 */
const SUBJECT_COMBINATIONS: SubjectCombinationSeed[] = [
  {
    courseName: 'Medicine and Surgery',
    compulsorySubject: 'Use of English',
    electiveSubjects: ['Biology', 'Chemistry', 'Physics'],
  },
  {
    courseName: 'Pharmacy',
    compulsorySubject: 'Use of English',
    electiveSubjects: ['Biology', 'Chemistry', 'Physics'],
  },
  {
    courseName: 'Nursing Science',
    compulsorySubject: 'Use of English',
    electiveSubjects: ['Biology', 'Chemistry', 'Physics'],
  },
  {
    courseName: 'Computer Science',
    compulsorySubject: 'Use of English',
    electiveSubjects: ['Mathematics', 'Physics', 'Chemistry'],
  },
  {
    courseName: 'Electrical Electronics Engineering',
    compulsorySubject: 'Use of English',
    electiveSubjects: ['Mathematics', 'Physics', 'Chemistry'],
  },
  {
    courseName: 'Mechanical Engineering',
    compulsorySubject: 'Use of English',
    electiveSubjects: ['Mathematics', 'Physics', 'Chemistry'],
  },
];

async function seedSubjectCombinations(): Promise<void> {
  for (const combination of SUBJECT_COMBINATIONS) {
    const combinationId = await upsertSubjectCombination(combination.courseName);

    const compulsorySubjectId = await upsertSubject(combination.compulsorySubject);
    await upsertSubjectCombinationSubject(combinationId, compulsorySubjectId, 'compulsory');

    for (const subjectName of combination.electiveSubjects) {
      const subjectId = await upsertSubject(subjectName);
      await upsertSubjectCombinationSubject(combinationId, subjectId, 'elective');
    }
  }
}

async function main(): Promise<void> {
  const raw = readFileSync(seedItemsPath, 'utf8');
  const data = JSON.parse(raw) as SeedFile;

  await seedItems(data.items);
  await seed2026ExamConfig();
  await seedSubjectCombinations();

  console.log(
    `seeded ${data.items.length} items, the 2026 exam config, and ${SUBJECT_COMBINATIONS.length} subject combinations`,
  );
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
