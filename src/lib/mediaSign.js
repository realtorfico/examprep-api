// Short-lived HMAC-signed URLs for R2-hosted study resources. Not AWS SigV4 (no need — we
// have a direct R2 binding, not S3 credentials) — just enough to make a link expire and to
// stop the public bucket URL from being freely shareable once the custom domain is removed.

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function sign(secret, file, exp) {
  const key = await hmacKey(secret);
  const data = new TextEncoder().encode(`${file}:${exp}`);
  const sigBuf = await crypto.subtle.sign('HMAC', key, data);
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Returns { file, exp, sig } — the query params /media/:file expects.
export async function signMediaUrl(env, file, ttlSeconds) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await sign(env.MEDIA_SIGNING_SECRET, file, exp);
  return { exp, sig };
}

export async function verifyMediaSig(env, file, exp, sig) {
  if (!file || !exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = await sign(env.MEDIA_SIGNING_SECRET, file, Number(exp));
  return expected === sig;
}
