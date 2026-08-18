'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../../../../src/auth/AuthProvider';
import { ContributionForm } from '../../../../src/components/ContributionForm';

/**
 * The structured authoring form for a brief this contributor has already
 * claimed (plan 7.12 step 3). Any active session may reach this page —
 * `submitContributedItem` itself is the enforcement point for "only the
 * claimant may submit," not a client-side check that could drift from it.
 */
export default function AuthorBriefPage() {
  const { session, apiClient, logout } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const briefId = Number(params.id);

  useEffect(() => {
    if (!session) {
      router.replace('/login');
    }
  }, [session, router]);

  if (!session) {
    return null;
  }

  return (
    <div className="flex h-dvh flex-col overflow-y-auto">
      <h1 className="p-6 pb-0 text-xl font-semibold text-gray-900">Author an item for brief #{briefId}</h1>
      <ContributionForm
        onSubmit={async (draft, sketchPhoto) => {
          const outcome = sketchPhoto
            ? await apiClient.submitContributedItemWithDiagram(session.token, briefId, draft, sketchPhoto)
            : await apiClient.submitContributedItem(session.token, briefId, draft);
          if (!outcome.ok) {
            if (outcome.reason === 'unauthorized') {
              logout();
              return { ok: false, message: 'unauthorized' };
            }
            return { ok: false, message: outcome.message };
          }
          return { ok: true };
        }}
      />
    </div>
  );
}
