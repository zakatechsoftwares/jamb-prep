import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CreateBriefInput } from '@jamb/shared';
import { CreateBriefForm } from './CreateBriefForm';

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Objective id'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Item count'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Fee in naira'), { target: { value: '5000' } });
  fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '2026-09-01' } });
}

describe('CreateBriefForm', () => {
  it('pre-fills the objective id from a selected gap', () => {
    render(<CreateBriefForm initialObjectiveId={12} onSubmit={async () => ({ ok: true })} />);
    expect((screen.getByLabelText('Objective id') as HTMLInputElement).value).toBe('12');
  });

  it('rejects a non-positive-integer objective id without calling onSubmit', async () => {
    let called = false;
    render(
      <CreateBriefForm
        onSubmit={async () => {
          called = true;
          return { ok: true };
        }}
      />,
    );
    fillValidForm();
    fireEvent.change(screen.getByLabelText('Objective id'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create brief' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/objective id/i);
    expect(called).toBe(false);
  });

  it('rejects malformed JSON in difficulty spread', async () => {
    render(<CreateBriefForm onSubmit={async () => ({ ok: true })} />);
    fillValidForm();
    fireEvent.change(screen.getByLabelText('Difficulty spread'), { target: { value: '{not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create brief' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/difficulty spread/i);
  });

  it('submits a well-formed brief, converting naira to kobo and the date to ISO', async () => {
    let submitted: CreateBriefInput | null = null;
    render(
      <CreateBriefForm
        onSubmit={async (input) => {
          submitted = input;
          return { ok: true };
        }}
      />,
    );
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create brief' }));

    await screen.findByText('Brief created.');
    expect(submitted).toMatchObject({
      objectiveId: 5,
      itemCount: 3,
      feeKobo: 500000,
      difficultySpread: { easy: 1 },
      cognitiveLevels: { recall: 1 },
    });
    expect(submitted!.deadline).toBe(new Date('2026-09-01').toISOString());
  });

  it('shows the server-reported error rather than a fabricated success', async () => {
    render(<CreateBriefForm onSubmit={async () => ({ ok: false, message: 'objective has no target set' })} />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create brief' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('objective has no target set');
    expect(screen.queryByText('Brief created.')).toBeNull();
  });
});
