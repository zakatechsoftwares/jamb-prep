import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { parsePositiveInteger, resolveReviewerId } from './reviewer-identity';

function requestWithQuery(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
}

describe('resolveReviewerId', () => {
  // The single point every reviewer-facing route reads reviewerId through.
  // These tests exist so that whichever request shape eventually replaces
  // the query parameter (a session, a bearer token) has a clear contract
  // to satisfy in one place, rather than five call sites re-deriving it.

  it('accepts a positive integer in the query string', () => {
    expect(resolveReviewerId(requestWithQuery({ reviewerId: '7' }))).toBe(7);
  });

  it('rejects a missing reviewerId', () => {
    expect(resolveReviewerId(requestWithQuery({}))).toBeNull();
  });

  it('rejects zero, negative, and fractional values', () => {
    expect(resolveReviewerId(requestWithQuery({ reviewerId: '0' }))).toBeNull();
    expect(resolveReviewerId(requestWithQuery({ reviewerId: '-3' }))).toBeNull();
    expect(resolveReviewerId(requestWithQuery({ reviewerId: '1.5' }))).toBeNull();
  });

  it('rejects non-numeric and non-string values', () => {
    expect(resolveReviewerId(requestWithQuery({ reviewerId: 'nonsense' }))).toBeNull();
    expect(resolveReviewerId(requestWithQuery({ reviewerId: ['7'] }))).toBeNull();
  });
});

describe('parsePositiveInteger', () => {
  it('accepts a positive integer string', () => {
    expect(parsePositiveInteger('42')).toBe(42);
  });

  it('rejects undefined, zero, negative and fractional values', () => {
    expect(parsePositiveInteger(undefined)).toBeNull();
    expect(parsePositiveInteger('0')).toBeNull();
    expect(parsePositiveInteger('-1')).toBeNull();
    expect(parsePositiveInteger('2.5')).toBeNull();
    expect(parsePositiveInteger('abc')).toBeNull();
  });
});
