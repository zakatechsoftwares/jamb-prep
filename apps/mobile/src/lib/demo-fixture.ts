import type { ExamConfig, OptionLabel } from '@jamb/shared';

/**
 * PLACEHOLDER content, not real synced items. This mobile-UI phase proves
 * the mock-session runtime (timer, navigation, force-close/resume,
 * scoring) works for real on-device, entirely offline, before the content
 * sync layer exists at all (see docs/build-log.md's mobile-UI phase entry
 * for why sync is a separate, later follow-up). A small demo blueprint —
 * 4 subjects x 5 items, 10 minutes — stands in for the real 180-item,
 * 120-minute exam_configs row until a subject pack can actually be
 * downloaded.
 */
export interface DemoOption {
  label: OptionLabel;
  text: string;
  isCorrect: boolean;
}

export interface DemoItem {
  itemId: number;
  subjectId: number;
  subjectName: string;
  stem: string;
  options: DemoOption[];
}

export const DEMO_SUBJECTS = [
  { subjectId: 1, name: 'Use of English' },
  { subjectId: 2, name: 'Mathematics' },
  { subjectId: 3, name: 'Biology' },
  { subjectId: 4, name: 'Physics' },
] as const;

function item(
  itemId: number,
  subjectId: number,
  subjectName: string,
  stem: string,
  options: [string, string, string, string],
  correctIndex: 0 | 1 | 2 | 3,
): DemoItem {
  const labels: OptionLabel[] = ['A', 'B', 'C', 'D'];
  return {
    itemId,
    subjectId,
    subjectName,
    stem,
    options: labels.map((label, index) => ({
      label,
      text: options[index]!,
      isCorrect: index === correctIndex,
    })),
  };
}

export const DEMO_ITEMS: DemoItem[] = [
  // Use of English -- lexis/structure at UTME difficulty, not primary-school recall
  item(1, 1, 'Use of English', 'The word "ubiquitous" most nearly means:', ['Rare', 'Everywhere', 'Ancient', 'Hidden'], 1),
  item(2, 1, 'Use of English', 'Choose the word opposite in meaning to "obstinate".', ['Stubborn', 'Yielding', 'Proud', 'Silent'], 1),
  item(3, 1, 'Use of English', 'Select the option that best completes the sentence: "Hardly ___ the meeting begun when the fire alarm rang."', ['had', 'has', 'did', 'was'], 0),
  item(4, 1, 'Use of English', 'Identify the correctly spelt word.', ['Occassion', 'Occasion', 'Ocassion', 'Occacion'], 1),
  item(5, 1, 'Use of English', 'Identify the figure of speech in: "The wind whispered through the trees."', ['Simile', 'Metaphor', 'Personification', 'Hyperbole'], 2),
  // Mathematics -- worked calculation items, not single-step arithmetic
  item(6, 2, 'Mathematics', 'If 2x - 3y = 7 and x + y = 6, find the value of x.', ['5', '4', '3', '6'], 0),
  item(7, 2, 'Mathematics', 'Simplify: (2^3 × 2^4) ÷ 2^5.', ['2', '4', '8', '16'], 1),
  item(8, 2, 'Mathematics', 'The nth term of a sequence is given by 3n - 2. Find the 10th term.', ['28', '25', '30', '32'], 0),
  item(9, 2, 'Mathematics', 'A trader bought an article for ₦8,000 and sold it for ₦9,600. Find the percentage profit.', ['15%', '20%', '18%', '25%'], 1),
  item(10, 2, 'Mathematics', 'Find the value of x if log₂x = 5.', ['10', '16', '25', '32'], 3),
  // Biology -- application/discrimination, not single-fact recall
  item(11, 3, 'Biology', 'Which of the following is a function of the liver?', ['Production of insulin', 'Detoxification of harmful substances', 'Filtration of blood in nephrons', 'Absorption of digested food'], 1),
  item(12, 3, 'Biology', 'The process by which plants lose water vapour through their leaves is called:', ['Osmosis', 'Transpiration', 'Diffusion', 'Guttation'], 1),
  item(13, 3, 'Biology', 'Which of these is NOT a characteristic of living things?', ['Respiration', 'Excretion', 'Crystallization', 'Growth'], 2),
  item(14, 3, 'Biology', 'In genetics, an organism with two identical alleles for a trait is said to be:', ['Heterozygous', 'Homozygous', 'Hybrid', 'Recessive'], 1),
  item(15, 3, 'Biology', 'The exchange of gases in the lungs occurs in the:', ['Bronchus', 'Trachea', 'Alveoli', 'Larynx'], 2),
  // Physics -- calculation and applied-concept items
  item(16, 4, 'Physics', 'A car accelerates uniformly from rest to 20 m/s in 4 seconds. Calculate its acceleration.', ['4 m/s²', '5 m/s²', '8 m/s²', '10 m/s²'], 1),
  item(17, 4, 'Physics', 'Calculate the work done when a force of 10N moves an object through a distance of 5m in the direction of the force.', ['2J', '15J', '50J', '500J'], 2),
  item(18, 4, 'Physics', 'Which of the following is a vector quantity?', ['Mass', 'Speed', 'Displacement', 'Energy'], 2),
  item(19, 4, 'Physics', 'A wave has a frequency of 50Hz and a wavelength of 4m. Calculate its speed.', ['12.5 m/s', '54 m/s', '200 m/s', '0.08 m/s'], 2),
  item(20, 4, 'Physics', 'Which law states that the pressure of a fixed mass of gas is inversely proportional to its volume at constant temperature?', ["Charles' Law", "Boyle's Law", "Gay-Lussac's Law", "Avogadro's Law"], 1),
];

export const DEMO_DURATION_MINUTES = 10;

/**
 * Does not correspond to any real `exam_configs` row -- the same disclosed
 * limitation as `DEMO_ITEMS`' fictional item ids (see progress-sync's own
 * build-log entry). A synced demo session's `startSession` call will fail
 * its foreign-key check server-side; the sync mechanism itself is still
 * exercised and proven correct against realistically-seeded data in
 * `packages/db`'s integration tests, just not against this fixture.
 */
export const DEMO_EXAM_CONFIG_ID = 0;

export const DEMO_EXAM_CONFIG: ExamConfig = {
  subjects: DEMO_SUBJECTS.map((subject) => ({
    subjectId: subject.subjectId,
    itemsPerSubject: 5,
    marksPerSubject: 25,
  })),
  totalMarks: 100,
};

export function findDemoItem(itemId: number): DemoItem {
  const found = DEMO_ITEMS.find((candidate) => candidate.itemId === itemId);
  if (!found) {
    throw new Error(`findDemoItem: no demo item with id ${itemId}`);
  }
  return found;
}
