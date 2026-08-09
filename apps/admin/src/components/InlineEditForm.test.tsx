import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ItemEditDraft } from '../lib/review-flow-reducer';
import { InlineEditForm } from './InlineEditForm';

const DRAFT: ItemEditDraft = {
  stem: 'What is the SI unit of force?',
  options: { A: 'newton', B: 'joule', C: 'watt', D: 'pascal' },
  key: 'A',
  explanation: "Force is measured in newtons, per Newton's second law.",
};

describe('InlineEditForm', () => {
  it('shows the current draft values in editable fields', () => {
    render(
      <InlineEditForm
        draft={DRAFT}
        pending={false}
        onChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByDisplayValue(DRAFT.stem)).toBeTruthy();
    expect(screen.getByDisplayValue('newton')).toBeTruthy();
    expect(screen.getByDisplayValue('joule')).toBeTruthy();
    expect(screen.getByDisplayValue(DRAFT.explanation)).toBeTruthy();
  });

  it('reports a stem edit through onChange without leaving the item', () => {
    let patch: unknown = null;
    render(
      <InlineEditForm
        draft={DRAFT}
        pending={false}
        onChange={(p) => (patch = p)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const stemField = screen.getByDisplayValue(DRAFT.stem);
    fireEvent.change(stemField, { target: { value: 'Corrected stem text' } });

    expect(patch).toEqual({ stem: 'Corrected stem text' });
  });

  it('reports an option edit scoped to just that label', () => {
    let patch: unknown = null;
    render(
      <InlineEditForm
        draft={DRAFT}
        pending={false}
        onChange={(p) => (patch = p)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const optionB = screen.getByDisplayValue('joule');
    fireEvent.change(optionB, { target: { value: 'kilojoule' } });

    expect(patch).toEqual({ options: { B: 'kilojoule' } });
  });

  it('reports a key change when the reviewer picks a different correct option', async () => {
    const user = userEvent.setup();
    let patch: unknown = null;
    render(
      <InlineEditForm
        draft={DRAFT}
        pending={false}
        onChange={(p) => (patch = p)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /b/i }));
    expect(patch).toEqual({ key: 'B' });
  });

  it('calls onConfirm and onCancel from their respective buttons', async () => {
    const user = userEvent.setup();
    let confirmed = false;
    let cancelled = false;
    render(
      <InlineEditForm
        draft={DRAFT}
        pending={false}
        onChange={() => {}}
        onConfirm={() => (confirmed = true)}
        onCancel={() => (cancelled = true)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(confirmed).toBe(true);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(cancelled).toBe(true);
  });
});
