'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { APP_NAME } from '@jamb/shared';
import { useAuth } from '../auth/AuthProvider';

/**
 * `POST /review/login` (session 06b), the one screen this session's
 * brief adds. Wrong password, an unknown identifier, no password set,
 * and an inactive-but-correct-password reviewer all collapse to the
 * same server response and the same message here — the form must not
 * re-introduce a distinction the API deliberately withholds.
 */
export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const outcome = await login(emailOrPhone, password);

    setSubmitting(false);
    if (!outcome.ok) {
      setError('Incorrect email/phone or password.');
      return;
    }
    router.replace('/');
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-surface-sunken p-6">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-gray-200 bg-surface p-6 shadow-sm"
      >
        <div className="flex flex-col gap-1 pb-1 text-center">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            {APP_NAME}
          </span>
          <h1 className="text-xl font-semibold text-gray-900">Reviewer sign in</h1>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold uppercase tracking-wide text-muted">Email or phone</span>
          <input
            aria-label="Email or phone"
            value={emailOrPhone}
            onChange={(event) => setEmailOrPhone(event.target.value)}
            autoComplete="username"
            className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900 transition-colors duration-150 focus:border-selected"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold uppercase tracking-wide text-muted">Password</span>
          <input
            aria-label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900 transition-colors duration-150 focus:border-selected"
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
          Log in
        </button>
      </form>
    </div>
  );
}
