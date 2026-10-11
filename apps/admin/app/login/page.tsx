'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../../src/auth/AuthProvider';
import { LoginForm } from '../../src/components/LoginForm';
import { homeRouteFor } from '../../src/lib/home-route';

export default function LoginPage() {
  const { session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (session) {
      router.replace(homeRouteFor(session));
    }
  }, [session, router]);

  if (session) {
    return null;
  }

  return (
    <div className="flex h-dvh flex-col">
      <LoginForm />
    </div>
  );
}
