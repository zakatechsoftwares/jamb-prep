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
  // Use of English
  item(1, 1, 'Use of English', 'Choose the word nearest in meaning to "candid".', ['Frank', 'Careful', 'Angry', 'Shy'], 0),
  item(2, 1, 'Use of English', 'Choose the word opposite in meaning to "scarce".', ['Rare', 'Plentiful', 'Costly', 'Hidden'], 1),
  item(3, 1, 'Use of English', 'Select the correct preposition: "He is good ___ mathematics."', ['in', 'on', 'at', 'for'], 2),
  item(4, 1, 'Use of English', 'Identify the correctly spelled word.', ['Recieve', 'Receive', 'Receeve', 'Receve'], 1),
  item(5, 1, 'Use of English', 'Choose the option that best completes: "Neither the teacher nor the students ___ ready."', ['is', 'was', 'were', 'be'], 2),
  // Mathematics
  item(6, 2, 'Mathematics', 'What is 15% of 200?', ['20', '30', '25', '35'], 1),
  item(7, 2, 'Mathematics', 'Simplify: 3x + 5x.', ['8x', '15x', '2x', '8x^2'], 0),
  item(8, 2, 'Mathematics', 'What is the value of x if 2x = 10?', ['3', '4', '5', '6'], 2),
  item(9, 2, 'Mathematics', 'Find the next number: 2, 4, 8, 16, ?', ['20', '24', '32', '18'], 2),
  item(10, 2, 'Mathematics', 'What is the perimeter of a square with side 4cm?', ['12cm', '16cm', '8cm', '20cm'], 1),
  // Biology
  item(11, 3, 'Biology', 'The functional unit of the kidney is the:', ['Neuron', 'Nephron', 'Alveolus', 'Villus'], 1),
  item(12, 3, 'Biology', 'Photosynthesis mainly occurs in the:', ['Root', 'Stem', 'Leaf', 'Flower'], 2),
  item(13, 3, 'Biology', 'Which blood cell fights infection?', ['Red blood cell', 'White blood cell', 'Platelet', 'Plasma'], 1),
  item(14, 3, 'Biology', 'The powerhouse of the cell is the:', ['Nucleus', 'Ribosome', 'Mitochondrion', 'Golgi body'], 2),
  item(15, 3, 'Biology', 'DNA is found mainly in the:', ['Cytoplasm', 'Nucleus', 'Cell wall', 'Vacuole'], 1),
  // Physics
  item(16, 4, 'Physics', 'The SI unit of force is the:', ['Joule', 'Newton', 'Watt', 'Pascal'], 1),
  item(17, 4, 'Physics', 'Sound cannot travel through:', ['Air', 'Water', 'Vacuum', 'Steel'], 2),
  item(18, 4, 'Physics', 'The speed of light is fastest in:', ['Water', 'Glass', 'Vacuum', 'Air'], 2),
  item(19, 4, 'Physics', 'Ohm’s law relates voltage, current and:', ['Power', 'Resistance', 'Energy', 'Frequency'], 1),
  item(20, 4, 'Physics', 'A freely falling body accelerates at approximately:', ['5 m/s²', '8 m/s²', '9.8 m/s²', '12 m/s²'], 2),
];

export const DEMO_DURATION_MINUTES = 10;

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
