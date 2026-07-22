// Auth helpers: Turnstile verification, bearer-token user lookup, Cloudflare Access JWT verification.
// No JWT library needed — Access JWTs are RS256 and Workers' crypto.subtle verifies RS256 natively.

export async function verifyTurnstile(token, secret, ip) {
  if (!secret) return true; // no-op until TURNSTILE_SECRET is configured, mirrors SofticianApi's Security.cs pattern
  if (!token) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await res.json();
  return data.success === true;
}

// Looks up the bearer token in D1, joined to the code's current status, so a revoked
// code invalidates the session on the very next request (no stale stateless token).
export async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT u.*, c.status AS code_status, c.expires_at AS code_expires_at
     FROM users u JOIN codes c ON c.redeemed_by = u.id
     WHERE u.token = ?`
  ).bind(token).first();

  if (!row) return null;
  if (row.code_status === 'revoked') return null;
  if (row.code_expires_at && row.code_expires_at < Math.floor(Date.now() / 1000)) return null;

  await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), row.id).run();

  return row;
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let jwksCache = null; // cached for the isolate's lifetime; cold starts refetch

async function getAccessJwks(teamDomain) {
  if (jwksCache) return jwksCache;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  jwksCache = await res.json();
  return jwksCache;
}

// Verifies the Cf-Access-Jwt-Assertion header the admin site's worker.js forwards through
// the same-origin proxy. Ported from SofticianApi's Utils/AccessAuth.cs pattern.
export async function requireAccess(request, env) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return false; // fail closed if unconfigured
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return false;

  const [headerB64, payloadB64, sigB64] = jwt.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) return false;

  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return false;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.CF_ACCESS_AUD)) return false;

  const jwks = await getAccessJwks(env.CF_ACCESS_TEAM_DOMAIN);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(sigB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  if (!valid) return false;

  if (env.CF_ACCESS_ALLOWED_EMAILS) {
    const allowed = env.CF_ACCESS_ALLOWED_EMAILS.split(',').map((e) => e.trim().toLowerCase());
    if (!allowed.includes((payload.email || '').toLowerCase())) return false;
  }
  return true;
}

export function newId() {
  return crypto.randomUUID();
}

export function newCode() {
  // Unambiguous alphabet (no 0/O/1/I/L) — human-typeable, grouped for readability.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const rand = crypto.getRandomValues(new Uint8Array(10));
  let s = '';
  for (let i = 0; i < 10; i++) s += alphabet[rand[i] % alphabet.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
