'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type {
  CreateReviewerAccountInput,
  ManageableReviewerStatus,
  ReviewerAccountSummary,
} from '@jamb/shared';
import { useAuth } from '../../../src/auth/AuthProvider';
import { CreateReviewerForm } from '../../../src/components/CreateReviewerForm';
import { ErrorState } from '../../../src/components/ErrorState';
import { ReviewerList } from '../../../src/components/ReviewerList';
import { SignOutButton } from '../../../src/components/SignOutButton';
import { TemporaryPasswordNotice } from '../../../src/components/TemporaryPasswordNotice';
import { useReviewerAccounts } from '../../../src/hooks/useReviewerAccounts';

interface IssuedPassword {
  fullName: string;
  signInWith: string;
  temporaryPassword: string;
}

/**
 * Panel account management (plan 7.8) — a `content_lead`-only route,
 * gated exactly like `/content-lead`. Where a contracted reviewer's
 * account is created, its password reset, and access suspended or
 * restored.
 */
export default function ContentLeadReviewersPage() {
  const { session } = useAuth();
  const router = useRouter();
  const { state, refresh, createAccount, resetPassword, setStatus } = useReviewerAccounts(
    session?.role === 'content_lead',
  );
  const [issued, setIssued] = useState<IssuedPassword | null>(null);
  const [busyReviewerId, setBusyReviewerId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace('/login');
      return;
    }
    if (session.role !== 'content_lead') {
      router.replace('/');
    }
  }, [session, router]);

  if (!session || session.role !== 'content_lead') {
    return null;
  }

  async function handleCreate(input: CreateReviewerAccountInput) {
    const result = await createAccount(input);
    if (!result.ok) {
      return result;
    }
    setIssued({
      fullName: input.fullName,
      signInWith: input.email,
      temporaryPassword: result.temporaryPassword,
    });
    return { ok: true as const };
  }

  async function handleReset(account: ReviewerAccountSummary) {
    setActionError(null);
    setBusyReviewerId(account.reviewerId);
    const result = await resetPassword(account.reviewerId);
    setBusyReviewerId(null);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    setIssued({
      fullName: account.fullName,
      signInWith: account.email ?? account.phone,
      temporaryPassword: result.temporaryPassword,
    });
  }

  async function handleSetStatus(account: ReviewerAccountSummary, status: ManageableReviewerStatus) {
    setActionError(null);
    setBusyReviewerId(account.reviewerId);
    const result = await setStatus(account.reviewerId, status);
    setBusyReviewerId(null);
    if (!result.ok) {
      setActionError(result.message);
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-surface-sunken">
      <div className="flex items-center justify-between gap-2 p-6 pb-0">
        <h1 className="text-xl font-semibold text-gray-900">Review panel</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push('/content-lead')}
            className="h-touch rounded-lg border-2 border-gray-200 bg-surface px-4 text-sm font-semibold text-gray-900"
          >
            Dashboard
          </button>
          <SignOutButton />
        </div>
      </div>

      {state.status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading…</div>
      )}

      {state.status === 'forbidden' && (
        <div className="flex flex-1 items-center justify-center text-sm text-reject">
          You do not have access to this page.
        </div>
      )}

      {state.status === 'error' && <ErrorState message={state.message} onRetry={refresh} />}

      {state.status === 'ready' && (
        <>
          {issued && (
            <TemporaryPasswordNotice
              fullName={issued.fullName}
              signInWith={issued.signInWith}
              temporaryPassword={issued.temporaryPassword}
              onDismiss={() => setIssued(null)}
            />
          )}

          <CreateReviewerForm subjects={state.subjects} onSubmit={handleCreate} />

          <h2 className="px-6 pb-2 text-lg font-semibold text-gray-900">Panel accounts</h2>
          {actionError && (
            <p role="alert" className="px-6 pb-2 text-sm font-medium text-reject">
              {actionError}
            </p>
          )}
          <ReviewerList
            accounts={state.accounts}
            onResetPassword={(account) => void handleReset(account)}
            onSetStatus={(account, status) => void handleSetStatus(account, status)}
            busyReviewerId={busyReviewerId}
          />
        </>
      )}
    </div>
  );
}
