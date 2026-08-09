import { Router } from 'express';
import { parseLoginInput, type AuthService } from '@jamb/shared';
import { signSessionToken } from '@jamb/db/session-tokens';
import { sessionSecret } from '../reviewer-identity';

const SESSION_TTL_MINUTES = 60;

/**
 * The one route that hands out a session token (the "reviewer logs in"
 * half of the session mechanism every other route's `resolveReviewerId`
 * assumes already happened). Every failure — wrong password, an identifier
 * matching nobody, a reviewer with no password set, and an inactive
 * reviewer's correct password — returns the same 401 shape. Collapsing the
 * first three mirrors `authenticateReviewer`'s own `invalid_credentials`;
 * the fourth is collapsed here too, on top of what the db layer already
 * reports distinctly, because nothing about *this* response needs to tell
 * a caller which case applies — the token is withheld either way.
 */
export function createAuthRouter(service: AuthService): Router {
  const router = Router();

  router.post('/login', (req, res, next) => {
    let input;
    try {
      input = parseLoginInput(req.body);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    service
      .login(input.emailOrPhone, input.password)
      .then((outcome) => {
        if (!outcome.ok) {
          res.status(401).json({ error: 'invalid_credentials' });
          return;
        }

        const token = signSessionToken(
          { reviewerId: outcome.reviewerId, role: outcome.role },
          sessionSecret(),
          new Date(),
          SESSION_TTL_MINUTES,
        );

        res.json({ token, reviewerId: outcome.reviewerId, role: outcome.role });
      })
      .catch(next);
  });

  return router;
}
