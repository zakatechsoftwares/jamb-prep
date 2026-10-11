import { describe, expect, it } from 'vitest';
import { PANEL_ROLES } from '@jamb/shared';
import { CHANGE_PASSWORD_ROUTE, homeRouteFor } from './home-route';

describe('homeRouteFor', () => {
  it('sends every role to the change-password screen while a temporary password is held', () => {
    for (const role of PANEL_ROLES) {
      expect(homeRouteFor({ role, mustChangePassword: true })).toBe(CHANGE_PASSWORD_ROUTE);
    }
  });

  it('sends a content lead to the dashboard and everyone else to the review workspace', () => {
    expect(homeRouteFor({ role: 'content_lead', mustChangePassword: false })).toBe('/content-lead');
    for (const role of ['reviewer', 'moderator', 'contributor'] as const) {
      expect(homeRouteFor({ role, mustChangePassword: false })).toBe('/');
    }
  });
});
