import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_REVIEWER_ROLES,
  MANAGEABLE_REVIEWER_STATUSES,
  MIN_PASSWORD_LENGTH,
  isManageableAccount,
  parseChangePasswordInput,
  parseCreateReviewerAccountInput,
  parseReviewerStatusInput,
} from './reviewer-account-policy';
import { PANEL_ROLES, REVIEWER_STATUSES } from './item-lifecycle';

const validCreate = {
  fullName: 'Adaeze Okafor',
  phone: '+2348031234567',
  email: 'adaeze@example.test',
  role: 'reviewer',
  subjectIds: [2, 5],
};

describe('vocabulary', () => {
  it('sets the minimum new-password length at 8', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('only assigns roles from PANEL_ROLES, and never content_lead', () => {
    for (const role of ASSIGNABLE_REVIEWER_ROLES) {
      expect(PANEL_ROLES).toContain(role);
    }
    expect(ASSIGNABLE_REVIEWER_ROLES).not.toContain('content_lead');
  });

  it('only manages statuses from REVIEWER_STATUSES — active and suspended', () => {
    for (const status of MANAGEABLE_REVIEWER_STATUSES) {
      expect(REVIEWER_STATUSES).toContain(status);
    }
    expect([...MANAGEABLE_REVIEWER_STATUSES].sort()).toEqual(['active', 'suspended']);
  });
});

describe('parseCreateReviewerAccountInput', () => {
  it('parses a well-formed body', () => {
    expect(parseCreateReviewerAccountInput(validCreate)).toEqual(validCreate);
  });

  it('trims fullName, phone and email', () => {
    expect(
      parseCreateReviewerAccountInput({
        ...validCreate,
        fullName: '  Adaeze Okafor ',
        phone: ' +2348031234567 ',
        email: ' adaeze@example.test ',
      }),
    ).toEqual(validCreate);
  });

  it('does not lowercase the email — login matches it exactly', () => {
    expect(
      parseCreateReviewerAccountInput({ ...validCreate, email: 'Adaeze@Example.test' }).email,
    ).toBe('Adaeze@Example.test');
  });

  it('throws when email is missing, null or blank — every panel account has one', () => {
    for (const email of [undefined, null, '', '   ']) {
      expect(() => parseCreateReviewerAccountInput({ ...validCreate, email })).toThrow(/email/);
    }
  });

  it('accepts a local phone format without a leading +', () => {
    expect(parseCreateReviewerAccountInput({ ...validCreate, phone: '08031234567' }).phone).toBe(
      '08031234567',
    );
  });

  it('throws when the raw input is not an object', () => {
    for (const bad of ['x', 42, null, undefined, [], true]) {
      expect(() => parseCreateReviewerAccountInput(bad)).toThrow();
    }
  });

  it('throws when fullName is missing, blank or not a string', () => {
    for (const fullName of [undefined, '', '   ', 42]) {
      expect(() => parseCreateReviewerAccountInput({ ...validCreate, fullName })).toThrow(
        /fullName/,
      );
    }
  });

  it('throws when phone is not digits with an optional leading +', () => {
    for (const phone of [undefined, '', '0803 123 4567', '0803-123-4567', 'phone', '+', '123', 42]) {
      expect(() => parseCreateReviewerAccountInput({ ...validCreate, phone })).toThrow(/phone/);
    }
  });

  it('throws when email is not shaped like an address', () => {
    for (const email of ['adaeze', '@example.test', 'adaeze@', 'a@b@c', 42]) {
      expect(() => parseCreateReviewerAccountInput({ ...validCreate, email })).toThrow(/email/);
    }
  });

  it('throws on a role outside ASSIGNABLE_REVIEWER_ROLES, including content_lead', () => {
    for (const role of [undefined, '', 'content_lead', 'admin', 42]) {
      expect(() => parseCreateReviewerAccountInput({ ...validCreate, role })).toThrow(/role/);
    }
  });

  it('throws when subjectIds is not an array of positive integers', () => {
    for (const subjectIds of [undefined, 'x', [0], [-1], [1.5], ['2'], null]) {
      expect(() => parseCreateReviewerAccountInput({ ...validCreate, subjectIds })).toThrow(
        /subjectIds/,
      );
    }
  });

  it('throws on duplicate subjectIds rather than silently de-duplicating', () => {
    expect(() =>
      parseCreateReviewerAccountInput({ ...validCreate, subjectIds: [2, 2] }),
    ).toThrow(/subjectIds/);
  });

  it('requires at least one subject for a reviewer or moderator — an empty queue otherwise', () => {
    for (const role of ['reviewer', 'moderator']) {
      expect(() =>
        parseCreateReviewerAccountInput({ ...validCreate, role, subjectIds: [] }),
      ).toThrow(/subjectIds/);
    }
  });

  it('allows a contributor with no subjects — the brief board is not subject-gated', () => {
    expect(
      parseCreateReviewerAccountInput({ ...validCreate, role: 'contributor', subjectIds: [] })
        .subjectIds,
    ).toEqual([]);
  });
});

describe('parseChangePasswordInput', () => {
  const longEnough = 'x'.repeat(MIN_PASSWORD_LENGTH);

  it('parses a well-formed body without trimming either password', () => {
    expect(
      parseChangePasswordInput({ currentPassword: ' Temp1234 ', newPassword: ` ${longEnough} ` }),
    ).toEqual({ currentPassword: ' Temp1234 ', newPassword: ` ${longEnough} ` });
  });

  it('throws when the raw input is not an object', () => {
    for (const bad of ['x', 42, null, undefined, []]) {
      expect(() => parseChangePasswordInput(bad)).toThrow();
    }
  });

  it('throws when currentPassword is missing, empty or not a string', () => {
    for (const currentPassword of [undefined, '', 42]) {
      expect(() => parseChangePasswordInput({ currentPassword, newPassword: longEnough })).toThrow(
        /currentPassword/,
      );
    }
  });

  it(`throws when newPassword is shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(() =>
      parseChangePasswordInput({
        currentPassword: 'Temp1234',
        newPassword: 'x'.repeat(MIN_PASSWORD_LENGTH - 1),
      }),
    ).toThrow(/newPassword/);
  });

  it('throws when newPassword equals currentPassword', () => {
    expect(() =>
      parseChangePasswordInput({ currentPassword: longEnough, newPassword: longEnough }),
    ).toThrow(/newPassword/);
  });

  it('never echoes either password into a thrown message', () => {
    const current = 'current-secret-value';
    const next = 'short';
    try {
      parseChangePasswordInput({ currentPassword: current, newPassword: next });
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(current);
      expect(message).not.toContain(next);
    }

    try {
      parseChangePasswordInput({ currentPassword: current, newPassword: current });
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(current);
    }
  });
});

describe('parseReviewerStatusInput', () => {
  it('parses active and suspended', () => {
    expect(parseReviewerStatusInput({ status: 'active' })).toEqual({ status: 'active' });
    expect(parseReviewerStatusInput({ status: 'suspended' })).toEqual({ status: 'suspended' });
  });

  it('throws on any status a content lead may not set by hand', () => {
    for (const status of [undefined, '', 'applied', 'calibrating', 'removed', 'banned', 42]) {
      expect(() => parseReviewerStatusInput({ status })).toThrow(/status/);
    }
  });

  it('throws when the raw input is not an object', () => {
    for (const bad of ['active', null, undefined, []]) {
      expect(() => parseReviewerStatusInput(bad)).toThrow();
    }
  });
});

describe('isManageableAccount', () => {
  it('is true exactly for an assignable role in a manageable status', () => {
    for (const role of PANEL_ROLES) {
      for (const status of REVIEWER_STATUSES) {
        const expected =
          (ASSIGNABLE_REVIEWER_ROLES as readonly string[]).includes(role) &&
          (MANAGEABLE_REVIEWER_STATUSES as readonly string[]).includes(status);
        expect(isManageableAccount({ role, status })).toBe(expected);
      }
    }
  });

  it('never lets a content lead manage another content_lead account', () => {
    expect(isManageableAccount({ role: 'content_lead', status: 'active' })).toBe(false);
  });

  it('leaves a removed reviewer alone — removal is not undone by a status toggle', () => {
    expect(isManageableAccount({ role: 'reviewer', status: 'removed' })).toBe(false);
  });
});
