import type { ContentDashboard } from '@jamb/shared';
import { aggregateRejectionReasons } from '@jamb/shared';
import { AlertTriangleIcon, CheckCircleIcon } from './icons';

export interface ContentLeadDashboardProps {
  dashboard: ContentDashboard;
}

interface MetricProps {
  label: string;
  value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-surface p-4 shadow-sm transition-shadow duration-150 hover:shadow-md">
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}

/** A plain proportion bar, purely decorative (aria-hidden, no text content) -- safe to place next to an exact-text-matched sibling without creating an ambiguous duplicate match. */
function ProportionBar({ fraction, colorClassName }: { fraction: number; colorClassName: string }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
    >
      <span className={`block h-full rounded-full ${colorClassName}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

/**
 * The content-lead dashboard (plan 7.11): accepted items per reviewer-hour,
 * cost per approved item (inference USD and reviewer fees kobo kept
 * separate — different currencies, never blended), queue depth, items by
 * state, inter-rater agreement (a content signal, not a reviewer signal),
 * and the rejection-reason aggregation. "Fix next" is
 * `aggregateRejectionReasons`'s top entry — the window-wide dominant
 * defect, not merely the first row of any one subject-week — which is what
 * makes the worst prompt defect obvious at a glance (the DONE WHEN
 * requirement) rather than something the reader has to scan a table for.
 */
export function ContentLeadDashboard({ dashboard }: ContentLeadDashboardProps) {
  const worstDefect = aggregateRejectionReasons(dashboard.rejectionReasons)[0] ?? null;
  const maxQueueDepth = Math.max(1, ...dashboard.queueDepth.map((row) => row.depth));
  const maxStateCount = Math.max(1, ...dashboard.itemsByState.map((row) => row.count));

  return (
    <div className="flex flex-col gap-8 bg-surface-sunken p-6">
      <h1 className="text-xl font-semibold text-gray-900">Content lead dashboard</h1>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="Headline metrics">
        <Metric
          label="Accepted items / reviewer-hour"
          value={dashboard.acceptedItemsPerReviewerHour.toFixed(2)}
        />
        <Metric
          label="Approved items"
          value={String(dashboard.costPerApprovedItem.approvedCount)}
        />
        <Metric
          label="Avg inference cost"
          value={`$${dashboard.costPerApprovedItem.avgInferenceCostUsd.toFixed(4)}`}
        />
        <Metric
          label="Avg reviewer fees"
          value={`₦${(dashboard.costPerApprovedItem.avgReviewerFeesKobo / 100).toFixed(2)}`}
        />
      </section>

      <section
        aria-label="Fix next"
        className="rounded-xl border border-gray-200 bg-surface p-4 shadow-sm"
      >
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Fix next</h2>
        {worstDefect ? (
          <p
            className="flex items-center gap-2 text-base text-gray-900"
            data-testid="top-defect"
          >
            <AlertTriangleIcon className="h-5 w-5 shrink-0 text-escalate" />
            Subject #{worstDefect.subjectId}: <strong>{worstDefect.rejectionReason}</strong> (
            {worstDefect.count} rejections this window)
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <CheckCircleIcon className="h-5 w-5 shrink-0 text-approve" />
            No rejections in this window.
          </p>
        )}
      </section>

      <section
        aria-label="Rejection reasons by subject and week"
        className="overflow-hidden rounded-xl border border-gray-200 bg-surface shadow-sm"
      >
        <h2 className="border-b border-gray-200 px-4 py-3 text-lg font-semibold text-gray-900">
          Rejection reasons by subject
        </h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-surface-sunken text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2">Subject</th>
              <th className="px-4 py-2">Week</th>
              <th className="px-4 py-2">Reason</th>
              <th className="px-4 py-2">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {dashboard.rejectionReasons.map((row, index) => (
              <tr
                key={`${row.subjectId}-${row.week.toISOString()}-${row.rejectionReason}-${index}`}
                className="odd:bg-surface even:bg-surface-sunken/40"
              >
                <td className="px-4 py-2">#{row.subjectId}</td>
                <td className="px-4 py-2">{row.week.toLocaleDateString()}</td>
                <td className="px-4 py-2">{row.rejectionReason}</td>
                <td className="px-4 py-2">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section
        aria-label="Queue depth by subject"
        className="rounded-xl border border-gray-200 bg-surface p-4 shadow-sm"
      >
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Queue depth</h2>
        <ul className="flex flex-col gap-2">
          {dashboard.queueDepth.map((row) => (
            <li key={row.subjectId} className="flex flex-col gap-1 text-sm text-gray-700">
              Subject #{row.subjectId}: {row.depth}
              <ProportionBar fraction={row.depth / maxQueueDepth} colorClassName="bg-selected" />
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Items by state"
        className="rounded-xl border border-gray-200 bg-surface p-4 shadow-sm"
      >
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Items by state</h2>
        <ul className="flex flex-col gap-2">
          {dashboard.itemsByState.map((row) => (
            <li key={row.status} className="flex flex-col gap-1 text-sm text-gray-700">
              {row.status}: {row.count}
              <ProportionBar fraction={row.count / maxStateCount} colorClassName="bg-gray-400" />
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Inter-rater agreement"
        className="rounded-xl border border-gray-200 bg-surface p-4 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-gray-900">Inter-rater agreement</h2>
        <p className="mb-3 text-sm text-muted">
          A content signal, not a reviewer signal — persistently low agreement means ambiguous
          items or unclear guidance.
        </p>
        <ul className="flex flex-col gap-2">
          {dashboard.interRaterAgreement.map((row) => (
            <li key={row.subjectId} className="flex flex-col gap-1 text-sm text-gray-700">
              Subject #{row.subjectId}: {(row.agreementRate * 100).toFixed(0)}% ({row.pairCount}{' '}
              pairs)
              <ProportionBar fraction={row.agreementRate} colorClassName="bg-selected" />
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Subject combination readiness"
        className="rounded-xl border border-gray-200 bg-surface p-4 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-gray-900">Mock-exam readiness by course</h2>
        <p className="mb-3 text-sm text-muted">
          Whether every subject in a course has enough approved items to fill the active exam
          blueprint — a coarser, faster signal than the queue/state views above; see the objective
          coverage view for what to source next.
        </p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {dashboard.subjectCombinationReadiness.map((combo) => (
            <li
              key={combo.subjectCombinationId}
              data-testid={`readiness-${combo.subjectCombinationId}`}
              className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-gray-900">{combo.courseName}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    combo.ready ? 'bg-approve-bg text-approve' : 'bg-reject-bg text-reject'
                  }`}
                >
                  {combo.ready ? 'Ready' : 'Not ready'}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {combo.subjects.map((subject) => (
                  <li key={subject.subjectId} className="flex flex-col gap-1 text-xs text-gray-700">
                    <span>
                      {subject.subjectName} ({subject.role}): {subject.approvedCount}/
                      {subject.requiredCount}
                      {!subject.ready && ' — short'}
                    </span>
                    <ProportionBar
                      fraction={subject.approvedCount / subject.requiredCount}
                      colorClassName={subject.ready ? 'bg-approve' : 'bg-reject'}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
