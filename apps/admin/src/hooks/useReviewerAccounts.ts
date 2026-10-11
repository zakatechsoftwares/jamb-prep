'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  CreateReviewerAccountInput,
  ManageableReviewerStatus,
  ReviewerAccountSummary,
  SubjectSummary,
} from '@jamb/shared';
import { useAuth } from '../auth/AuthProvider';
import type { ManageReviewerAccountFailure } from '../lib/api-client';

export type ReviewerAccountsState =
  | { status: 'loading' }
  | { status: 'ready'; accounts: ReviewerAccountSummary[]; subjects: SubjectSummary[] }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

export type TemporaryPasswordResult =
  | { ok: true; temporaryPassword: string }
  | { ok: false; message: string };

export type ActionResult = { ok: true } | { ok: false; message: string };

const CREATE_FAILURE_MESSAGES = {
  phone_taken: 'That phone number already belongs to an account.',
  email_taken: 'That email address already belongs to an account.',
  unknown_subject: 'One of the selected subjects no longer exists. Reload and try again.',
  forbidden: 'You do not have access to create accounts.',
} as const;

function manageFailureMessage(
  failure: Exclude<ManageReviewerAccountFailure, { reason: 'unauthorized' }>,
): string {
  switch (failure.reason) {
    case 'not_found':
      return 'That account no longer exists.';
    case 'not_manageable':
      return 'That account cannot be changed from here.';
    case 'forbidden':
      return 'You do not have access to manage accounts.';
    case 'request_failed':
      return failure.message;
  }
}

/**
 * The content lead's panel-account management (plan 7.8). Same
 * `enabled`-gated-fetch shape as `useContentLeadBriefs`: the owning page's
 * redirect for a non-content-lead session is itself an effect, so without
 * `enabled` the fetch here would fire once on the same mount first.
 */
export function useReviewerAccounts(enabled: boolean): {
  state: ReviewerAccountsState;
  refresh: () => void;
  createAccount: (input: CreateReviewerAccountInput) => Promise<TemporaryPasswordResult>;
  resetPassword: (reviewerId: number) => Promise<TemporaryPasswordResult>;
  setStatus: (reviewerId: number, status: ManageableReviewerStatus) => Promise<ActionResult>;
} {
  const { session, apiClient, logout } = useAuth();
  const [state, setState] = useState<ReviewerAccountsState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!session || !enabled) {
      return;
    }
    let cancelled = false;

    function fail(
      failure:
        | { reason: 'unauthorized' | 'forbidden' }
        | { reason: 'request_failed'; message: string },
    ): void {
      if ('message' in failure) {
        setState({ status: 'error', message: failure.message });
      } else if (failure.reason === 'unauthorized') {
        logout();
      } else {
        setState({ status: 'forbidden' });
      }
    }

    void Promise.all([
      apiClient.listReviewerAccounts(session.token),
      apiClient.listSubjects(session.token),
    ]).then(([accounts, subjects]) => {
      if (cancelled) {
        return;
      }
      if (!accounts.ok) {
        fail(accounts);
        return;
      }
      if (!subjects.ok) {
        fail(subjects);
        return;
      }
      setState({ status: 'ready', accounts: accounts.accounts, subjects: subjects.subjects });
    });

    return () => {
      cancelled = true;
    };
  }, [session, enabled, apiClient, logout, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const createAccount = useCallback(
    async (input: CreateReviewerAccountInput): Promise<TemporaryPasswordResult> => {
      if (!session) {
        return { ok: false, message: 'not authenticated' };
      }
      const outcome = await apiClient.createReviewerAccount(session.token, input);
      if (outcome.ok) {
        refresh();
        return { ok: true, temporaryPassword: outcome.temporaryPassword };
      }
      if (outcome.reason === 'unauthorized') {
        logout();
        return { ok: false, message: 'unauthorized' };
      }
      if (outcome.reason === 'invalid_input' || outcome.reason === 'request_failed') {
        return { ok: false, message: outcome.message };
      }
      return { ok: false, message: CREATE_FAILURE_MESSAGES[outcome.reason] };
    },
    [session, apiClient, logout, refresh],
  );

  const resetPassword = useCallback(
    async (reviewerId: number): Promise<TemporaryPasswordResult> => {
      if (!session) {
        return { ok: false, message: 'not authenticated' };
      }
      const outcome = await apiClient.resetReviewerPassword(session.token, reviewerId);
      if (outcome.ok) {
        refresh();
        return { ok: true, temporaryPassword: outcome.temporaryPassword };
      }
      if (outcome.reason === 'unauthorized') {
        logout();
        return { ok: false, message: 'unauthorized' };
      }
      return { ok: false, message: manageFailureMessage(outcome) };
    },
    [session, apiClient, logout, refresh],
  );

  const setStatus = useCallback(
    async (reviewerId: number, status: ManageableReviewerStatus): Promise<ActionResult> => {
      if (!session) {
        return { ok: false, message: 'not authenticated' };
      }
      const outcome = await apiClient.setReviewerStatus(session.token, reviewerId, status);
      if (outcome.ok) {
        refresh();
        return { ok: true };
      }
      if (outcome.reason === 'unauthorized') {
        logout();
        return { ok: false, message: 'unauthorized' };
      }
      return { ok: false, message: manageFailureMessage(outcome) };
    },
    [session, apiClient, logout, refresh],
  );

  return { state, refresh, createAccount, resetPassword, setStatus };
}
