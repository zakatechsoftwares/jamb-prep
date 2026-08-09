'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../src/auth/AuthProvider';
import { DecideStep } from '../src/components/DecideStep';
import { EmptyQueueState } from '../src/components/EmptyQueueState';
import { ErrorState } from '../src/components/ErrorState';
import { InlineEditForm } from '../src/components/InlineEditForm';
import { RejectionReasonPicker } from '../src/components/RejectionReasonPicker';
import { ReviewHeader } from '../src/components/ReviewHeader';
import { SolveStep } from '../src/components/SolveStep';
import { useReviewFlow } from '../src/hooks/useReviewFlow';
import { useReviewFlowKeyboard } from '../src/hooks/useReviewFlowKeyboard';

/**
 * The single-item reviewer workspace (plan 7.9). One screen, one item —
 * there is deliberately no list, filter, search or queue browser
 * anywhere in this tree, on desktop or mobile.
 */
export default function ReviewPage() {
  const { session } = useAuth();
  const router = useRouter();
  const flow = useReviewFlow();
  useReviewFlowKeyboard(flow);

  useEffect(() => {
    if (!session) {
      router.replace('/login');
    }
  }, [session, router]);

  if (!session) {
    return null;
  }

  const { state } = flow;

  return (
    <div className="flex h-dvh flex-col">
      <ReviewHeader reviewedThisSession={flow.reviewedThisSession} />

      {state.status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-500">Loading…</div>
      )}

      {state.status === 'empty' && <EmptyQueueState onRetry={() => void flow.retry()} />}

      {state.status === 'error' && (
        <ErrorState message={state.message} onRetry={() => void flow.retry()} />
      )}

      {state.status === 'solving' && (
        <SolveStep
          item={state.item}
          selected={state.selected}
          pending={state.pending}
          onSelect={flow.selectOption}
          onSubmit={() => void flow.submitSolve()}
        />
      )}

      {state.status === 'deciding' && (
        <DecideStep
          item={state.item}
          reveal={state.reveal}
          pending={state.pending}
          onApprove={() => void flow.approve()}
          onEscalate={() => void flow.escalate()}
          onStartReject={flow.startReject}
          onStartEdit={flow.startEdit}
        />
      )}

      {state.status === 'choosingReason' && (
        <RejectionReasonPicker
          pending={state.pending}
          onChoose={(reason) => void flow.chooseReason(reason)}
          onCancel={flow.cancel}
        />
      )}

      {state.status === 'editing' && (
        <InlineEditForm
          draft={state.draft}
          pending={state.pending}
          onChange={flow.updateDraft}
          onConfirm={() => void flow.confirmEdit()}
          onCancel={flow.cancel}
        />
      )}
    </div>
  );
}
