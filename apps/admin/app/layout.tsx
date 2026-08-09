import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '../src/auth/AuthProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'JAMB UTME Prep — Reviewer Workspace',
};

// width=device-width and a fixed initial scale, since this is a workspace
// meant to be driven by thumb at exactly 360px, not a page a reviewer
// pinch-zooms around.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="h-dvh bg-gray-50 text-gray-900 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
