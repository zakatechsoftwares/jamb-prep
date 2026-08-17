import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ContributedItemInput } from '@jamb/shared';
import { ContributionForm } from './ContributionForm';

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Stem'), { target: { value: 'What is the SI unit of force?' } });
  fireEvent.change(screen.getByLabelText('Explanation'), { target: { value: 'Newton is the SI unit.' } });
  fireEvent.change(screen.getByLabelText('Option A text'), { target: { value: 'newton' } });
  fireEvent.change(screen.getByLabelText('Option B text'), { target: { value: 'joule' } });
  fireEvent.change(screen.getByLabelText('Option C text'), { target: { value: 'watt' } });
  fireEvent.change(screen.getByLabelText('Option D text'), { target: { value: 'pascal' } });
  fireEvent.change(screen.getByLabelText('Option B distractor rationale'), {
    target: { value: 'confuses energy' },
  });
  fireEvent.change(screen.getByLabelText('Option C distractor rationale'), {
    target: { value: 'confuses power' },
  });
  fireEvent.change(screen.getByLabelText('Option D distractor rationale'), {
    target: { value: 'confuses pressure' },
  });
}

describe('ContributionForm', () => {
  it('defaults option A as correct, hiding its own rationale field', () => {
    render(<ContributionForm onSubmit={async () => ({ ok: true })} />);
    expect(screen.queryByLabelText('Option A distractor rationale')).toBeNull();
    expect(screen.getByLabelText('Option B distractor rationale')).toBeTruthy();
  });

  it('moves the rationale requirement when a different option is marked correct', () => {
    render(<ContributionForm onSubmit={async () => ({ ok: true })} />);
    fireEvent.click(screen.getByLabelText('Option C is correct'));

    expect(screen.getByLabelText('Option A distractor rationale')).toBeTruthy();
    expect(screen.queryByLabelText('Option C distractor rationale')).toBeNull();
  });

  it('rejects a missing stem without calling onSubmit', async () => {
    let called = false;
    render(
      <ContributionForm
        onSubmit={async () => {
          called = true;
          return { ok: true };
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Submit item' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/stem/i);
    expect(called).toBe(false);
  });

  it('rejects a wrong option with no distractor rationale', async () => {
    render(<ContributionForm onSubmit={async () => ({ ok: true })} />);
    fillValidForm();
    fireEvent.change(screen.getByLabelText('Option B distractor rationale'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit item' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/option b/i);
  });

  it('submits a well-formed item with method steps split by line and one option marked correct', async () => {
    let submitted: ContributedItemInput | null = null;
    render(
      <ContributionForm
        onSubmit={async (draft) => {
          submitted = draft;
          return { ok: true };
        }}
      />,
    );
    fillValidForm();
    fireEvent.change(screen.getByLabelText('Method steps'), {
      target: { value: 'Recall F = ma.\n\nIdentify the SI unit.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit item' }));

    await screen.findByText('Item submitted.');
    expect(submitted!.methodSteps).toEqual(['Recall F = ma.', 'Identify the SI unit.']);
    expect(submitted!.options.filter((option) => option.isCorrect)).toHaveLength(1);
    expect(submitted!.options.find((option) => option.label === 'A')).toMatchObject({
      isCorrect: true,
      distractorRationale: null,
    });
    expect(submitted!.options.find((option) => option.label === 'B')).toMatchObject({
      isCorrect: false,
      distractorRationale: 'confuses energy',
    });
  });

  it('shows the server-reported error rather than a fabricated success', async () => {
    render(<ContributionForm onSubmit={async () => ({ ok: false, message: 'brief already completed' })} />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Submit item' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('brief already completed');
    expect(screen.queryByText('Item submitted.')).toBeNull();
  });
});
