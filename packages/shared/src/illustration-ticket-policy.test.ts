import { describe, expect, it } from 'vitest';
import { isIllustrationTicketClaimable } from './illustration-ticket-policy';

describe('isIllustrationTicketClaimable', () => {
  it('is claimable when open', () => {
    expect(isIllustrationTicketClaimable('open')).toBe(true);
  });

  it('is not claimable once claimed', () => {
    expect(isIllustrationTicketClaimable('claimed')).toBe(false);
  });

  it('is not claimable once completed', () => {
    expect(isIllustrationTicketClaimable('completed')).toBe(false);
  });

  it('throws for an unrecognized status', () => {
    // @ts-expect-error deliberately passing a value outside IllustrationTicketStatus
    expect(() => isIllustrationTicketClaimable('cancelled')).toThrow(/status/);
  });
});
