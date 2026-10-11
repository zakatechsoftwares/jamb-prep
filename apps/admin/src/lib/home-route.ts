import type { PanelRole } from '@jamb/shared';

export const CHANGE_PASSWORD_ROUTE = '/account/password';

/**
 * Where a signed-in session belongs. The one statement of this rule —
 * `LoginForm`, the login page's already-signed-in redirect and the
 * change-password page all route through it, so they can never disagree
 * about where the same session should land.
 */
export function homeRouteFor(session: { role: PanelRole; mustChangePassword: boolean }): string {
  if (session.mustChangePassword) {
    return CHANGE_PASSWORD_ROUTE;
  }
  return session.role === 'content_lead' ? '/content-lead' : '/';
}
