'use client';

import { useState } from 'react';

export interface TemporaryPasswordNoticeProps {
  fullName: string;
  signInWith: string;
  temporaryPassword: string;
  onDismiss: () => void;
}

/**
 * The one and only time a temporary password is visible. It is never
 * stored in plain text and cannot be retrieved later — losing it means
 * issuing a fresh one with "Reset password", which this notice says.
 */
export function TemporaryPasswordNotice({
  fullName,
  signInWith,
  temporaryPassword,
  onDismiss,
}: TemporaryPasswordNoticeProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (permissions, insecure context);
      // the password is still on screen to copy by hand.
      setCopied(false);
    }
  }

  return (
    <section
      role="status"
      aria-label="Temporary password"
      className="m-6 flex flex-col gap-3 rounded-xl border-2 border-approve bg-approve-bg p-6"
    >
      <h2 className="text-lg font-semibold text-gray-900">Temporary password for {fullName}</h2>
      <p className="text-sm text-gray-900">
        Send this to them now. They sign in with <strong>{signInWith}</strong> and will be asked
        to choose their own password straight away.
      </p>
      <code className="select-all rounded-lg bg-surface px-3 py-2 text-center font-mono text-xl tracking-wider text-gray-900">
        {temporaryPassword}
      </code>
      <p className="text-xs text-muted">
        This is the only time it will be shown. If it is lost, use “Reset password” to issue a
        new one.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="h-touch flex-1 rounded-lg bg-selected px-4 text-sm font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-blue-700"
        >
          {copied ? 'Copied' : 'Copy password'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="h-touch flex-1 rounded-lg border-2 border-gray-200 bg-surface px-4 text-sm font-semibold text-gray-900"
        >
          Done
        </button>
      </div>
    </section>
  );
}
