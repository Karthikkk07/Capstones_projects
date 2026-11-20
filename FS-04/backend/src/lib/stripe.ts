import Stripe from 'stripe';
import { env } from '../config/env';
import { AppError } from './errors';

let client: Stripe | null = null;

/** Returns the Stripe client, or throws a clear 503 when STRIPE_SECRET_KEY is not configured. */
export function getStripe(): Stripe {
  if (client) return client;
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'Billing is not configured: STRIPE_SECRET_KEY is not set');
  }
  client = new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

/** Injection point for tests (pass null to reset). */
export function setStripeClient(custom: Stripe | null): void {
  client = custom;
}
