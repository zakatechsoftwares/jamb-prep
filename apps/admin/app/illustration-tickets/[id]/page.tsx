'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../src/auth/AuthProvider';

/**
 * The claimed-ticket detail view (plan 7.12 step 5): the contributor's
 * sketch photo and figure description on one side, the illustrator's own
 * SVG + alt text on the other. Accepts the SVG either pasted as markup or
 * read client-side from an uploaded `.svg` file (`File.text()`) — either
 * way it travels to the server as plain JSON text, never multipart, since
 * SVG is XML text, not binary.
 */
export default function IllustrationTicketDetailPage() {
  const { session, apiClient, logout } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const ticketId = Number(params.id);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [svgMarkup, setSvgMarkup] = useState('');
  const [altText, setAltText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    if (!session) {
      router.replace('/login');
    }
  }, [session, router]);

  useEffect(() => {
    if (!session) {
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;

    apiClient.fetchSketchPhoto(session.token, ticketId).then((outcome) => {
      if (cancelled) {
        return;
      }
      if (!outcome.ok) {
        if (outcome.reason === 'unauthorized') {
          logout();
          return;
        }
        setPhotoError(outcome.message);
        return;
      }
      objectUrl = URL.createObjectURL(outcome.blob);
      setPhotoUrl(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [session, apiClient, logout, ticketId]);

  if (!session) {
    return null;
  }

  async function handleSvgFile(file: File) {
    setSvgMarkup(await file.text());
  }

  async function handleSubmit() {
    if (!session) {
      return;
    }
    setError(null);
    if (svgMarkup.trim() === '') {
      setError('SVG markup is required.');
      return;
    }
    if (altText.trim() === '') {
      setError('Alt text is required.');
      return;
    }

    setSubmitting(true);
    const outcome = await apiClient.completeIllustrationTicket(session.token, ticketId, {
      svgMarkup,
      altText,
    });
    setSubmitting(false);

    if (!outcome.ok) {
      if (outcome.reason === 'unauthorized') {
        logout();
        return;
      }
      setError(outcome.message);
      return;
    }
    setSucceeded(true);
  }

  return (
    <div className="flex h-dvh flex-col gap-4 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-gray-900">Illustration ticket #{ticketId}</h1>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold uppercase tracking-wide text-gray-500">Sketch photo</span>
        {photoError && (
          <p role="alert" className="text-sm font-medium text-reject">
            {photoError}
          </p>
        )}
        {photoUrl && (
          <img
            src={photoUrl}
            alt="Contributor's hand sketch"
            className="max-w-full rounded-lg border-2 border-gray-200"
          />
        )}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">SVG markup</span>
        <textarea
          aria-label="SVG markup"
          value={svgMarkup}
          onChange={(event) => setSvgMarkup(event.target.value)}
          className="rounded-lg border-2 border-gray-200 p-3 font-mono text-sm text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">
          Or upload an .svg file
        </span>
        <input
          type="file"
          accept=".svg,image/svg+xml"
          aria-label="SVG file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleSvgFile(file);
            }
          }}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Alt text</span>
        <textarea
          aria-label="Alt text"
          value={altText}
          onChange={(event) => setAltText(event.target.value)}
          className="rounded-lg border-2 border-gray-200 p-3 text-base text-gray-900"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm font-medium text-reject">
          {error}
        </p>
      )}
      {succeeded && <p className="text-sm font-medium text-approve">Illustration submitted.</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="h-touch rounded-lg bg-selected text-base font-semibold text-white disabled:bg-gray-300"
      >
        Submit illustration
      </button>
    </div>
  );
}
