import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// jsdom has no IndexedDB implementation; this installs one on globalThis so
// the offline store (session 08) can be exercised for real rather than
// mocked. Each test that touches it should use its own database name (see
// offline-store.ts) rather than relying on any cross-test reset here.
import 'fake-indexeddb/auto';

// RTL's own auto-cleanup only registers when it detects test-framework
// globals (Jest-style implicit `afterEach`), which vitest does not inject
// by default here — this repo prefers explicit imports over `test.globals`.
// Without this, a component left mounted by one test collides with the
// next test's queries.
afterEach(() => {
  cleanup();
});
