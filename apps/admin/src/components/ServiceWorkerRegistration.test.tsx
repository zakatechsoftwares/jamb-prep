import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ServiceWorkerRegistration } from './ServiceWorkerRegistration';

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

afterEach(() => {
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  } else {
    // @ts-expect-error -- deleting a property that may not exist in jsdom by default
    delete navigator.serviceWorker;
  }
});

describe('ServiceWorkerRegistration', () => {
  it('registers /sw.js when the browser supports service workers', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    });

    render(<ServiceWorkerRegistration />);

    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('renders nothing', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    const { container } = render(<ServiceWorkerRegistration />);
    expect(container.innerHTML).toBe('');
  });

  it('does nothing when the browser has no serviceWorker support, without throwing', () => {
    // @ts-expect-error -- simulating an older browser
    delete navigator.serviceWorker;

    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
  });

  it('does not throw when registration itself rejects', async () => {
    const register = vi.fn().mockRejectedValue(new Error('no https'));
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    });

    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
    await Promise.resolve();
  });
});
