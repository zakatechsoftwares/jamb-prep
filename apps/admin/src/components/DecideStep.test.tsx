import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewQueueItem, RevealResult } from '@jamb/shared';
import { DecideStep } from './DecideStep';

const ITEM: ReviewQueueItem = {
  itemId: 42,
  subjectId: 1,
  objectiveId: 7,
  stem: 'What is the SI unit of force?',
  options: [
    { label: 'A', text: 'newton' },
    { label: 'B', text: 'joule' },
    { label: 'C', text: 'watt' },
    { label: 'D', text: 'pascal' },
  ],
  cognitiveLevel: 'recall',
  independentSolveVerdict: 'agreed',
  claimExpiresAt: new Date('2026-08-09T10:00:00.000Z'),
};

const noop = {
  onApprove: () => {},
  onEscalate: () => {},
  onStartReject: () => {},
  onStartEdit: () => {},
};

describe('DecideStep', () => {
  it('shows the stem, options, correct answer and explanation', () => {
    const reveal: RevealResult = {
      correctOption: 'A',
      explanation: "Force is measured in newtons, per Newton's second law.",
      verdict: 'agreed',
      agreesWithKey: null,
    };
    render(<DecideStep item={ITEM} reveal={reveal} pending={false} {...noop} />);

    expect(screen.getByText(ITEM.stem)).toBeTruthy();
    expect(screen.getByText(reveal.explanation)).toBeTruthy();
    for (const option of ITEM.options) {
      expect(screen.getByText(option.text)).toBeTruthy();
    }
  });

  it('shows all four actions as large, distinguishable controls', () => {
    const reveal: RevealResult = {
      correctOption: 'A',
      explanation: 'x',
      verdict: 'agreed',
      agreesWithKey: null,
    };
    render(<DecideStep item={ITEM} reveal={reveal} pending={false} {...noop} />);

    expect(screen.getByRole('button', { name: /^approve$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /edit/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /reject/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /escalate/i })).toBeTruthy();
  });

  it('makes disagreement visually prominent when the reviewer disagreed with the proposed key', () => {
    const reveal: RevealResult = {
      correctOption: 'A',
      explanation: 'x',
      verdict: 'agreed',
      agreesWithKey: false,
    };
    render(<DecideStep item={ITEM} reveal={reveal} pending={false} {...noop} />);

    expect(screen.getByText(/disagreed/i)).toBeTruthy();
  });

  it('shows no agreement banner at all when the reviewer never blind-solved (low-tier item)', () => {
    const reveal: RevealResult = {
      correctOption: 'A',
      explanation: 'x',
      verdict: 'agreed',
      agreesWithKey: null,
    };
    render(<DecideStep item={ITEM} reveal={reveal} pending={false} {...noop} />);

    expect(screen.queryByText(/disagreed/i)).toBeNull();
    expect(screen.queryByText(/^agreed$/i)).toBeNull();
  });

  it('calls onApprove and onEscalate directly, with no intermediate step', async () => {
    const user = userEvent.setup();
    let approved = false;
    let escalated = false;
    const reveal: RevealResult = {
      correctOption: 'A',
      explanation: 'x',
      verdict: 'agreed',
      agreesWithKey: null,
    };
    render(
      <DecideStep
        item={ITEM}
        reveal={reveal}
        pending={false}
        {...noop}
        onApprove={() => (approved = true)}
        onEscalate={() => (escalated = true)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(approved).toBe(true);

    await user.click(screen.getByRole('button', { name: /escalate/i }));
    expect(escalated).toBe(true);
  });

  it('calls onStartReject and onStartEdit rather than deciding immediately', async () => {
    const user = userEvent.setup();
    let rejectStarted = false;
    let editStarted = false;
    const reveal: RevealResult = {
      correctOption: 'A',
      explanation: 'x',
      verdict: 'agreed',
      agreesWithKey: null,
    };
    render(
      <DecideStep
        item={ITEM}
        reveal={reveal}
        pending={false}
        {...noop}
        onStartReject={() => (rejectStarted = true)}
        onStartEdit={() => (editStarted = true)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /reject/i }));
    expect(rejectStarted).toBe(true);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    expect(editStarted).toBe(true);
  });

  it('disables every action while pending', () => {
    const reveal: RevealResult = {
      correctOption: 'A',
      explanation: 'x',
      verdict: 'agreed',
      agreesWithKey: null,
    };
    render(<DecideStep item={ITEM} reveal={reveal} pending={true} {...noop} />);

    for (const name of [/^approve$/i, /edit/i, /reject/i, /escalate/i]) {
      expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
    }
  });
});
