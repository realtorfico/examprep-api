// Stripe Payment Intents API helpers. Same trust model as paypal.js: create-intent looks up
// the price from D1 (never trusts a client-reported amount), and confirm re-verifies the
// captured amount against that same server-trusted price before a code is ever issued.
// Stripe's REST API is form-encoded (not JSON), unlike PayPal's.

const API_BASE = 'https://api.stripe.com/v1';

function form(fields) {
  const params = new URLSearchParams();
  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    params.set(key, String(value));
  });
  return params;
}

// automatic_payment_methods lets Stripe decide which methods to show (card, Apple Pay,
// Google Pay, ...) based on the buyer's device/browser -- no need to enumerate them here.
export async function createStripePaymentIntent(env, amountCents, currency, opts) {
  const res = await fetch(`${API_BASE}/payment_intents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      amount: amountCents,
      currency: currency.toLowerCase(),
      'automatic_payment_methods[enabled]': 'true',
      receipt_email: opts && opts.email,
      'metadata[examType]': opts && opts.examType,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`stripe_create_intent_failed: ${(data.error && data.error.message) || res.status}`);
  return data;
}

export async function retrieveStripePaymentIntent(env, paymentIntentId) {
  const res = await fetch(`${API_BASE}/payment_intents/${paymentIntentId}?expand[]=latest_charge`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`stripe_retrieve_intent_failed: ${(data.error && data.error.message) || res.status}`);
  return data;
}
