/** Shared by every HTTP-calling client in this package, so each is testable against a fake, network-free implementation. */
export type FetchImpl = typeof fetch;
