import { describe, expect, it } from 'vitest';
import { buildAuthoringPrompt } from './authoring-prompt';

describe('buildAuthoringPrompt', () => {
  it('includes every piece of context and the requested count', () => {
    const prompt = buildAuthoringPrompt({
      subject: 'Chemistry',
      topic: 'Stoichiometry',
      subtopic: 'Mole concept',
      objectiveText: 'Calculate molar mass from a chemical formula.',
      difficultyTarget: 'moderate',
      cognitiveLevel: 'application',
      count: 10,
    });

    expect(prompt).toContain('SUBJECT: Chemistry');
    expect(prompt).toContain('TOPIC: Stoichiometry');
    expect(prompt).toContain('SUBTOPIC: Mole concept');
    expect(prompt).toContain('SYLLABUS OBJECTIVE: Calculate molar mass from a chemical formula.');
    expect(prompt).toContain('DIFFICULTY TARGET: moderate');
    expect(prompt).toContain('COGNITIVE LEVEL: application');
    expect(prompt).toContain('COUNT: 10');
    expect(prompt).toContain('Write 10 original multiple-choice items');
  });

  it('requests contains_calculation and the {{OPTION:X}} placeholder convention', () => {
    const prompt = buildAuthoringPrompt({
      subject: 'Chemistry',
      topic: 'Stoichiometry',
      subtopic: 'Mole concept',
      objectiveText: 'x',
      difficultyTarget: 'moderate',
      cognitiveLevel: 'application',
      count: 10,
    });

    expect(prompt).toContain('contains_calculation');
    expect(prompt).toContain('{{OPTION:A}}');
  });

  it('requests distractor_rationale and forbids all/none-of-the-above', () => {
    const prompt = buildAuthoringPrompt({
      subject: 'Chemistry',
      topic: 'Stoichiometry',
      subtopic: 'Mole concept',
      objectiveText: 'x',
      difficultyTarget: 'moderate',
      cognitiveLevel: 'application',
      count: 10,
    });

    expect(prompt).toContain('distractor_rationale');
    expect(prompt.toLowerCase()).toContain('no "all of the above"');
    expect(prompt.toLowerCase()).toContain('no "none of the above"');
  });
});
