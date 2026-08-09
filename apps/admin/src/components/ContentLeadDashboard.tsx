import type { ContentDashboard } from '@jamb/shared';
import { aggregateRejectionReasons } from '@jamb/shared';

export interface ContentLeadDashboardProps {
  dashboard: ContentDashboard;
}

interface MetricProps {
  label: string;
  value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
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

  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-xl font-semibold">Content lead dashboard</h1>

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

      <section aria-label="Fix next">
        <h2 className="text-lg font-semibold">Fix next</h2>
        {worstDefect ? (
          <p className="text-base" data-testid="top-defect">
            Subject #{worstDefect.subjectId}: <strong>{worstDefect.rejectionReason}</strong> (
            {worstDefect.count} rejections this window)
          </p>
        ) : (
          <p className="text-sm text-gray-500">No rejections in this window.</p>
        )}
      </section>

      <section aria-label="Rejection reasons by subject and week">
        <h2 className="text-lg font-semibold">Rejection reasons by subject</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="pr-4">Subject</th>
              <th className="pr-4">Week</th>
              <th className="pr-4">Reason</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.rejectionReasons.map((row, index) => (
              <tr key={`${row.subjectId}-${row.week.toISOString()}-${row.rejectionReason}-${index}`}>
                <td className="pr-4">#{row.subjectId}</td>
                <td className="pr-4">{row.week.toLocaleDateString()}</td>
                <td className="pr-4">{row.rejectionReason}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Queue depth by subject">
        <h2 className="text-lg font-semibold">Queue depth</h2>
        <ul>
          {dashboard.queueDepth.map((row) => (
            <li key={row.subjectId}>
              Subject #{row.subjectId}: {row.depth}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Items by state">
        <h2 className="text-lg font-semibold">Items by state</h2>
        <ul>
          {dashboard.itemsByState.map((row) => (
            <li key={row.status}>
              {row.status}: {row.count}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Inter-rater agreement">
        <h2 className="text-lg font-semibold">Inter-rater agreement</h2>
        <p className="text-sm text-gray-500">
          A content signal, not a reviewer signal — persistently low agreement means ambiguous
          items or unclear guidance.
        </p>
        <ul>
          {dashboard.interRaterAgreement.map((row) => (
            <li key={row.subjectId}>
              Subject #{row.subjectId}: {(row.agreementRate * 100).toFixed(0)}% ({row.pairCount}{' '}
              pairs)
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
