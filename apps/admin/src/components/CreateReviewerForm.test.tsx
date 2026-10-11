import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateReviewerForm } from './CreateReviewerForm';

const SUBJECTS = [
  { id: 2, name: 'Physics' },
  { id: 5, name: 'Biology' },
];

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Full name'));
  await user.paste('Adaeze Okafor');
  await user.click(screen.getByLabelText('Phone'));
  await user.paste('+2348031234567');
  await user.click(screen.getByLabelText('Email'));
  await user.paste('adaeze@example.test');
}

describe('CreateReviewerForm', () => {
  it('offers every assignable role and never content lead', () => {
    render(<CreateReviewerForm subjects={SUBJECTS} onSubmit={vi.fn()} />);
    const options = Array.from(
      (screen.getByLabelText('Role') as HTMLSelectElement).options,
    ).map((option) => option.value);
    expect(options).toEqual(['reviewer', 'moderator', 'contributor']);
  });

  it('submits the parsed input and clears the form on success', async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    render(<CreateReviewerForm subjects={SUBJECTS} onSubmit={onSubmit} />);

    await fillBasics(user);
    await user.click(screen.getByLabelText('Physics'));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      fullName: 'Adaeze Okafor',
      phone: '+2348031234567',
      email: 'adaeze@example.test',
      role: 'reviewer',
      subjectIds: [2],
    });
    await waitFor(() =>
      expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe(''),
    );
    expect((screen.getByLabelText('Physics') as HTMLInputElement).checked).toBe(false);
  });

  it('refuses a reviewer with no subject before submitting, using the server rule', async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn();
    render(<CreateReviewerForm subjects={SUBJECTS} onSubmit={onSubmit} />);

    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/subject/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('allows a contributor with no subject', async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    render(<CreateReviewerForm subjects={SUBJECTS} onSubmit={onSubmit} />);

    await fillBasics(user);
    await user.selectOptions(screen.getByLabelText('Role'), 'contributor');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ role: 'contributor', subjectIds: [] }));
  });

  it('keeps what was typed and shows the message when the server refuses', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <CreateReviewerForm
        subjects={SUBJECTS}
        onSubmit={async () => ({ ok: false, message: 'That phone number already belongs to an account.' })}
      />,
    );

    await fillBasics(user);
    await user.click(screen.getByLabelText('Biology'));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'That phone number already belongs to an account.',
      ),
    );
    expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Adaeze Okafor');
  });
});
