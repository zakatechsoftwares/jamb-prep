import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewQueueItem } from '@jamb/shared';
import { SolveStep } from './SolveStep';

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
  diagram: null,
};

describe('SolveStep', () => {
  it('shows the stem and all four options, never a key or explanation', () => {
    render(
      <SolveStep
        item={ITEM}
        selected={null}
        pending={false}
        onSelect={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByText(ITEM.stem)).toBeTruthy();
    for (const option of ITEM.options) {
      expect(screen.getByText(option.text)).toBeTruthy();
    }
    // Plan 7.10: the blind-solve control only works if there is nothing on
    // this screen that could anchor the reviewer's own answer.
    expect(screen.queryByText(/explanation/i)).toBeNull();
    expect(screen.queryByText(/correct/i)).toBeNull();
  });

  it('calls onSelect with the tapped option label', async () => {
    const user = userEvent.setup();
    let selected: string | null = null;
    render(
      <SolveStep
        item={ITEM}
        selected={null}
        pending={false}
        onSelect={(option) => (selected = option)}
        onSubmit={() => {}}
      />,
    );

    await user.click(screen.getByText('newton'));
    expect(selected).toBe('A');
  });

  it('disables submit until an option is selected', () => {
    const { rerender } = render(
      <SolveStep
        item={ITEM}
        selected={null}
        pending={false}
        onSelect={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /submit/i }).hasAttribute('disabled')).toBe(true);

    rerender(
      <SolveStep
        item={ITEM}
        selected="B"
        pending={false}
        onSelect={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /submit/i }).hasAttribute('disabled')).toBe(false);
  });

  it('calls onSubmit when the submit button is tapped with a selection', async () => {
    const user = userEvent.setup();
    let submitted = false;
    render(
      <SolveStep
        item={ITEM}
        selected="C"
        pending={false}
        onSelect={() => {}}
        onSubmit={() => (submitted = true)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(submitted).toBe(true);
  });

  it('disables submit while pending, so a double tap cannot double-submit', () => {
    render(
      <SolveStep item={ITEM} selected="A" pending={true} onSelect={() => {}} onSubmit={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /submit/i }).hasAttribute('disabled')).toBe(true);
  });

  describe('queued offline (session 08)', () => {
    it('shows a queued notice and disables further input, since reveal stays online-only', () => {
      render(
        <SolveStep
          item={ITEM}
          selected="A"
          pending={false}
          queued
          onSelect={() => {}}
          onSubmit={() => {}}
        />,
      );

      expect(screen.getByText(/queued/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /submit/i }).hasAttribute('disabled')).toBe(true);
      for (const option of ITEM.options) {
        expect(screen.getByRole('button', { name: new RegExp(option.text) }).hasAttribute('disabled')).toBe(
          true,
        );
      }
    });

    it('does not show the queued notice when not queued', () => {
      render(
        <SolveStep
          item={ITEM}
          selected="A"
          pending={false}
          onSelect={() => {}}
          onSubmit={() => {}}
        />,
      );
      expect(screen.queryByText(/queued/i)).toBeNull();
    });
  });
});
