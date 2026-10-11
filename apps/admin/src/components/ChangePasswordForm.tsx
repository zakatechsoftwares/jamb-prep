'use client';

import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '@jamb/shared';

export interface ChangePasswordFormProps {
  /** True when the account still holds a temporary password a content lead issued. */
  forced: boolean;
  onSubmit: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}

const INPUT_CLASS =
  'h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900 transition-colors duration-150 focus:border-selected';

/**
 * Replacing a password — forced after a content lead issued a temporary
 * one, or voluntary. Mirrors the server's own rules
 * (`parseChangePasswordInput`) client-side so a too-short or unchanged
 * password is caught before a round trip; the confirmation field is the
 * one check that exists only here.
 */
export function ChangePasswordForm({ forced, onSubmit }: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Your new password must be different from your current one.');
      return;
    }

    setSubmitting(true);
    const result = await onSubmit(currentPassword, newPassword);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-surface-sunken p-6">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-gray-200 bg-surface p-6 shadow-sm"
      >
        <div className="flex flex-col gap-1 pb-1 text-center">
          <h1 className="text-xl font-semibold text-gray-900">
            {forced ? 'Choose your password' : 'Change password'}
          </h1>
          {forced && (
            <p className="text-sm text-muted">
              You signed in with a temporary password. Choose your own before you continue.
            </p>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold uppercase tracking-wide text-muted">
            {forced ? 'Temporary password' : 'Current password'}
          </span>
          <input
            aria-label="Current password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold uppercase tracking-wide text-muted">New password</span>
          <input
            aria-label="New password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            className={INPUT_CLASS}
          />
          <span className="text-xs text-muted">At least {MIN_PASSWORD_LENGTH} characters.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold uppercase tracking-wide text-muted">
            Confirm new password
          </span>
          <input
            aria-label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            className={INPUT_CLASS}
          />
        </label>

        {error && (
          <p role="alert" className="text-sm font-medium text-reject">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="h-touch rounded-lg bg-selected text-base font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-blue-700 disabled:bg-gray-300 disabled:shadow-none"
        >
          Save password
        </button>
      </form>
    </div>
  );
}
