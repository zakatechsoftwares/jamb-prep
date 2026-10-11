'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../src/auth/AuthProvider';
import { ChangePasswordForm } from '../../../src/components/ChangePasswordForm';
import { SignOutButton } from '../../../src/components/SignOutButton';
import { homeRouteFor } from '../../../src/lib/home-route';

/**
 * Where a reviewer replaces their password — every session holding a
 * temporary password is held here by `PasswordChangeGate`, and any
 * signed-in reviewer can come here voluntarily.
 */
export default function ChangePasswordPage() {
  const { session, changePassword } = useAuth();
  const router = useRouter();
  // Captured on mount: once the change succeeds the session's flag clears,
  // and the heading must not flip mid-submit.
  const [forced] = useState(() => session?.mustChangePassword === true);

  useEffect(() => {
    if (!session) {
      router.replace('/login');
    }
  }, [session, router]);

  if (!session) {
    return null;
  }
  const { role } = session;

  async function handleSubmit(currentPassword: string, newPassword: string) {
    const outcome = await changePassword(currentPassword, newPassword);
    if (outcome.ok) {
      router.replace(homeRouteFor({ role, mustChangePassword: false }));
      return { ok: true as const };
    }
    switch (outcome.reason) {
      case 'wrong_current_password':
        return {
          ok: false as const,
          message: forced
            ? 'That temporary password is not correct.'
            : 'Your current password is not correct.',
        };
      case 'unauthorized':
        return { ok: false as const, message: 'Your session has ended. Please sign in again.' };
      default:
        return { ok: false as const, message: outcome.message };
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <ChangePasswordForm forced={forced} onSubmit={handleSubmit} />
      <div className="flex justify-center bg-surface-sunken pb-6">
        <SignOutButton />
      </div>
    </div>
  );
}
