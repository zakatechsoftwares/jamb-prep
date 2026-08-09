import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL's own auto-cleanup only registers when it detects test-framework
// globals (Jest-style implicit `afterEach`), which vitest does not inject
// by default here — this repo prefers explicit imports over `test.globals`.
// Without this, a component left mounted by one test collides with the
// next test's queries.
afterEach(() => {
  cleanup();
});
