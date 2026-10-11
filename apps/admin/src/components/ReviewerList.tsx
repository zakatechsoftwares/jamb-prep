'use client';

import {
  isManageableAccount,
  type ManageableReviewerStatus,
  type PanelRole,
  type ReviewerAccountSummary,
} from '@jamb/shared';

export interface ReviewerListProps {
  accounts: ReviewerAccountSummary[];
  onResetPassword: (account: ReviewerAccountSummary) => void;
  onSetStatus: (account: ReviewerAccountSummary, status: ManageableReviewerStatus) => void;
  /** The account an action is in flight for, if any — its buttons are disabled. */
  busyReviewerId?: number | null;
}

const ROLE_LABELS: Record<PanelRole, string> = {
  content_lead: 'Content lead',
  moderator: 'Subject moderator',
  reviewer: 'Reviewer',
  contributor: 'Contributor',
};

const STATUS_CLASSES: Record<string, string> = {
  active: 'bg-approve-bg text-approve',
  suspended: 'bg-escalate-bg text-escalate',
  removed: 'bg-reject-bg text-reject',
};

/**
 * Every panel account. Actions are offered only where `isManageableAccount`
 * — the same rule the API enforces — allows them, so a content-lead or
 * removed account shows no buttons rather than buttons that fail.
 */
export function ReviewerList({
  accounts,
  onResetPassword,
  onSetStatus,
  busyReviewerId = null,
}: ReviewerListProps) {
  if (accounts.length === 0) {
    return <p className="px-6 text-sm text-muted">No panel accounts yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2 px-6 pb-6" aria-label="Panel accounts">
      {accounts.map((account) => {
        const manageable = isManageableAccount(account);
        const busy = busyReviewerId === account.reviewerId;

        return (
          <li
            key={account.reviewerId}
            aria-label={account.fullName}
            className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-surface p-4 text-sm shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-base font-semibold text-gray-900">{account.fullName}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[account.status] ?? 'bg-gray-100 text-muted'}`}
              >
                {account.status}
              </span>
            </div>
            <span className="text-muted">
              {ROLE_LABELS[account.role]} · {account.phone}
              {account.email ? ` · ${account.email}` : ''}
            </span>
            <span className="text-muted">
              {account.subjects.length > 0
                ? account.subjects.map((subject) => subject.name).join(', ')
                : 'No subjects'}
            </span>
            {account.mustChangePassword && (
              <span className="text-xs font-medium text-escalate">
                Has not yet chosen their own password
              </span>
            )}

            {manageable && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onResetPassword(account)}
                  className="h-touch rounded-lg border-2 border-gray-200 bg-surface px-4 text-sm font-semibold text-gray-900 disabled:text-gray-300"
                >
                  Reset password
                </button>
                {account.status === 'active' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSetStatus(account, 'suspended')}
                    className="h-touch rounded-lg border-2 border-reject px-4 text-sm font-semibold text-reject disabled:border-gray-200 disabled:text-gray-300"
                  >
                    Suspend
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSetStatus(account, 'active')}
                    className="h-touch rounded-lg border-2 border-approve px-4 text-sm font-semibold text-approve disabled:border-gray-200 disabled:text-gray-300"
                  >
                    Reactivate
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
