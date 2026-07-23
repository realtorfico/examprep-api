// PayPal Orders API v2 helpers. Server-side integration by design: create-order looks up the
// price from D1 (never trusts a client-reported amount), and capture-order re-verifies the
// captured amount against that same server-trusted price before a code is ever issued.

function apiBase(env) {
  return env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

let tokenCache = null; // { token, expiresAt } — cached for the isolate's lifetime, like auth.js's jwksCache

async function getPayPalAccessToken(env) {
  if (tokenCache && tokenCache.expiresAt > Date.now() / 1000 + 30) return tokenCache.token;

  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`paypal_oauth_failed: ${data.error_description || res.status}`);
  tokenCache = { token: data.access_token, expiresAt: Date.now() / 1000 + data.expires_in };
  return tokenCache.token;
}

export async function createPayPalOrder(env, priceCents, currency) {
  const token = await getPayPalAccessToken(env);
  const amount = (priceCents / 100).toFixed(2);
  const res = await fetch(`${apiBase(env)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: currency, value: amount } }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`paypal_create_order_failed: ${data.message || res.status}`);
  return data;
}

export async function capturePayPalOrder(env, orderId) {
  const token = await getPayPalAccessToken(env);
  const res = await fetch(`${apiBase(env)}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`paypal_capture_failed: ${data.message || res.status}`);
  return data;
}
