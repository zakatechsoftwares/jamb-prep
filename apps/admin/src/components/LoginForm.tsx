'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { APP_NAME } from '@jamb/shared';
import { useAuth } from '../auth/AuthProvider';
import { homeRouteFor } from '../lib/home-route';

/**
 * `POST /review/login` (session 06b), the one screen this session's
 * brief adds.
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
    router.replace(homeRouteFor(outcome));
  }

  return (
    <div className="relative flex flex-1 items-center justify-center bg-surface-sunken p-6">
      <div className="w-full max-w-md">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-5 rounded-2xl border border-gray-200/90 bg-surface p-8 shadow-md"
        >
          <div className="flex flex-col items-center gap-2 pb-2 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-selected-bg px-3 py-1 text-xs font-bold uppercase tracking-wider text-selected">
              {APP_NAME} • Portal
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Reviewer sign in</h1>
            <p className="text-sm text-muted">
              Enter your authorized reviewer credentials to access the evaluation queue.
            </p>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold uppercase tracking-wider text-gray-700 text-xs">
              Email or phone
            </span>
            <input
              aria-label="Email or phone"
              value={emailOrPhone}
              onChange={(event) => setEmailOrPhone(event.target.value)}
              autoComplete="username"
              placeholder="reviewer@example.com"
              className="h-touch rounded-xl border border-gray-300 bg-surface px-3.5 text-base text-gray-900 shadow-2xs transition-colors duration-150 focus:border-selected focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold uppercase tracking-wider text-gray-700 text-xs">
              Password
            </span>
            <input
              aria-label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              className="h-touch rounded-xl border border-gray-300 bg-surface px-3.5 text-base text-gray-900 shadow-2xs transition-colors duration-150 focus:border-selected focus:bg-white"
            />
          </label>

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-reject/30 bg-reject-bg p-3 text-sm font-semibold text-reject"
            >
              <span aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex h-touch items-center justify-center rounded-xl bg-selected text-base font-bold text-white shadow-sm transition-all duration-150 hover:bg-blue-700 active:scale-[0.99] disabled:bg-gray-300 disabled:shadow-none"
          >
            {submitting ? 'Authenticating…' : 'Log in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Offline-first secure evaluator workspace • Authorized personnel only
        </p>
      </div>
    </div>
  );
}
