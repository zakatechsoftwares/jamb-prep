'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
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
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold text-gray-900">Reviewer sign in</h1>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Email or phone</span>
        <input
          aria-label="Email or phone"
          value={emailOrPhone}
          onChange={(event) => setEmailOrPhone(event.target.value)}
          autoComplete="username"
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Password</span>
        <input
          aria-label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
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
        className="h-touch rounded-lg bg-selected text-base font-semibold text-white disabled:bg-gray-300"
      >
        Log in
      </button>
    </form>
  );
}
