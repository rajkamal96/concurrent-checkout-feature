/**
 * Fake payment service.
 *
 * Behaviour is controlled by the PAYMENT_MODE environment variable:
 *   succeed  — resolves immediately with a payment reference  (default)
 *   fail     — rejects, simulating a payment gateway error
 *   hang     — never resolves (simulates a slow/unresponsive provider)
 *
 * The checkout endpoint wraps this in a Promise.race with a 6-second
 * timeout, so "hang" will be treated as a failure after 6 s.
 */

export interface PaymentResult {
  ref: string; // Payment reference ID
}

export function fakePayment(): Promise<PaymentResult> {
  const mode = process.env.PAYMENT_MODE ?? 'succeed';

  switch (mode) {
    case 'succeed':
      return Promise.resolve({ ref: `PAY-${Date.now()}-${Math.random().toString(36).slice(2)}` });

    case 'fail':
      return Promise.reject(new Error('Payment declined by provider'));

    case 'hang':
      // Never resolves — the checkout timeout will handle it
      return new Promise(() => {});

    default:
      console.warn(`Unknown PAYMENT_MODE "${mode}", defaulting to succeed`);
      return Promise.resolve({ ref: `PAY-${Date.now()}` });
  }
}

/**
 * Returns a promise that rejects after `ms` milliseconds.
 * Used with Promise.race to enforce a payment timeout.
 */
export function paymentTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Payment timed out after ${ms}ms`)), ms)
  );
}
