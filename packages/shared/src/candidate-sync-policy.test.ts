import { describe, expect, it } from 'vitest';
import { buildAttemptUploadPayloads, type LocalProgressEvent } from './candidate-sync-policy';

const SESSION_STARTED_AT = new Date('2026-08-19T08:00:00.000Z');

function event(overrides: Partial<LocalProgressEvent> = {}): LocalProgressEvent {
  return {
    itemId: 1,
    chosenOption: 'A',
    flagged: false,
    occurredAt: new Date('2026-08-19T08:00:30.000Z'),
    idempotencyKey: 'key-1',
    ...overrides,
  };
}

describe('buildAttemptUploadPayloads', () => {
  it('derives secondsTaken as the elapsed time since the session started, for the first event', () => {
    const [payload] = buildAttemptUploadPayloads(SESSION_STARTED_AT, [
      event({ occurredAt: new Date('2026-08-19T08:00:30.000Z') }),
    ]);

    expect(payload!.secondsTaken).toBe(30);
  });

  it('derives secondsTaken as the elapsed time since the previous event, not the session start, for later events', () => {
    const payloads = buildAttemptUploadPayloads(SESSION_STARTED_AT, [
      event({ itemId: 1, occurredAt: new Date('2026-08-19T08:00:30.000Z'), idempotencyKey: 'key-1' }),
      event({ itemId: 2, occurredAt: new Date('2026-08-19T08:01:00.000Z'), idempotencyKey: 'key-2' }),
    ]);

    expect(payloads[0]!.secondsTaken).toBe(30);
    expect(payloads[1]!.secondsTaken).toBe(30);
  });

  it('advances the elapsed-time clock past a flag-only event, but emits no payload for it', () => {
    const payloads = buildAttemptUploadPayloads(SESSION_STARTED_AT, [
      event({
        itemId: 1,
        chosenOption: null,
        flagged: true,
        occurredAt: new Date('2026-08-19T08:00:10.000Z'),
        idempotencyKey: 'key-flag',
      }),
      event({
        itemId: 1,
        chosenOption: 'A',
        occurredAt: new Date('2026-08-19T08:00:40.000Z'),
        idempotencyKey: 'key-1',
      }),
    ]);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ itemId: 1, secondsTaken: 30 });
  });

  it('carries itemId, chosenOption, flagged and idempotencyKey through unchanged', () => {
    const [payload] = buildAttemptUploadPayloads(SESSION_STARTED_AT, [
      event({ itemId: 7, chosenOption: 'C', flagged: true, idempotencyKey: 'key-7' }),
    ]);

    expect(payload).toMatchObject({ itemId: 7, chosenOption: 'C', flagged: true, idempotencyKey: 'key-7' });
  });

  it('serialises answeredAt as an ISO string', () => {
    const [payload] = buildAttemptUploadPayloads(SESSION_STARTED_AT, [
      event({ occurredAt: new Date('2026-08-19T08:00:30.000Z') }),
    ]);

    expect(payload!.answeredAt).toBe('2026-08-19T08:00:30.000Z');
  });

  it('never produces a negative secondsTaken, even if events are out of order', () => {
    const [payload] = buildAttemptUploadPayloads(SESSION_STARTED_AT, [
      event({ occurredAt: new Date('2026-08-19T07:59:00.000Z') }), // before the session started
    ]);

    expect(payload!.secondsTaken).toBe(0);
  });

  it('returns an empty array for no events', () => {
    expect(buildAttemptUploadPayloads(SESSION_STARTED_AT, [])).toEqual([]);
  });
});
