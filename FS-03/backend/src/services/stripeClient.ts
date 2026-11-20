import Stripe from 'stripe';
import { env } from '../config/env';
import { HttpError } from '../lib/errors';

let override: Stripe | null = null;
let cached: Stripe | null = null;

/** Allows tests (or other environments) to inject a fake Stripe client. */
export function setStripeClient(client: Stripe | null): void {
  override = client;
}

export function isStripeConfigured(): boolean {
  return Boolean(override || env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (override) return override;
  if (!env.STRIPE_SECRET_KEY) {
    throw HttpError.unavailable('Payments are not configured (STRIPE_SECRET_KEY missing)');
  }
  cached ??= new Stripe(env.STRIPE_SECRET_KEY);
  return cached;
}
