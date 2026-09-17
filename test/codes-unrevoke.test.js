// Admin "Un-revoke" for access codes (owner request 2026-09-17, after an accidental revoke with no way back).
//
// What revoke does: the admin console's POST /console/codes/revoke is a single
// `UPDATE codes SET status = 'revoked'` -- nothing else changes, no timestamp, no email, no user row. Its
// effect is that the code's user is locked out (requireUser rejects a revoked code) and the code can't be
// redeemed. So un-revoke restores the status the code had: 'redeemed' if someone redeemed it (redeemed_by
// set), otherwise 'unused' -- after which the row is identical to before the revoke and access works again.
//
// The other thing that revokes a code is marking a 7-day refund claim "refunded" (the buyer got their money
// back). Un-revoke refuses those (409 code_refunded) -- restoring access there would give a refunded buyer
// the product back, which isn't undoing a mistake.
//
// Goes through the real router with a genuine Cloudflare Access login (RS256 JWT, same approach as
// security-console-access.test.js), so routing and admin auth are exercised too.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, call } from './_harness.js';
import { seedPaidContent, TOKENS, USERS } from './_paid-content-fixture.js';

const TEAM = 'team.example.cloudflareaccess.com';
const AUD = 'test-aud-123';
const KID = 'test-kid-1';
const nowSec = () => Math.floor(Date.now() / 1000);

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(Buffer.from(JSON.stringify(obj)));
const keys = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
async function adminJwt() {
  const head = b64urlJson({ alg: 'RS256', typ: 'JWT', kid: KID });
  const body = b64urlJson({ aud: [AUD], email: 'admin@example.com', exp: nowSec() + 3600, iss: `https://${TEAM}` });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] }));
  return realFetch(url, init);
};

function setup() {
  const db = makeDb();
  seedPaidContent(db);
  db.prepare(`INSERT INTO codes (code, exam_type, status, issued_at, note, expires_at) VALUES ('CODE-UNUSED', 'ca_cdl', 'unused', 1789000000, 'gift for a friend', 1999999999)`).run();
  const env = Object.assign(makeEnv(db), { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD });
  return { db, env };
}
const codeRow = (db, code) => ({ ...db.prepare('SELECT * FROM codes WHERE code = ?').get(code) });
const asAdmin = async (env, method, path, body) => call(env, method, path, { body, headers: { 'Cf-Access-Jwt-Assertion': await adminJwt() } });
const revoke = (env, code) => asAdmin(env, 'POST', '/console/codes/revoke', { code });
const unrevoke = (env, code) => asAdmin(env, 'POST', '/console/codes/unrevoke', { code });

// ---- Restores everything revoke did ---------------------------------------------------------------

test('revoke then un-revoke a redeemed code: row is identical to before, and the user gets access back', async () => {
  const { db, env } = setup();
  const before = codeRow(db, 'CODE-FULL');
  assert.equal((await call(env, 'GET', '/profile', { token: TOKENS.full })).status, 200, 'baseline: user has access');

  assert.equal((await revoke(env, 'CODE-FULL')).status, 200);
  assert.equal(codeRow(db, 'CODE-FULL').status, 'revoked');
  assert.notEqual((await call(env, 'GET', '/profile', { token: TOKENS.full })).status, 200, 'revoked: user locked out');

  const res = await unrevoke(env, 'CODE-FULL');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, status: 'redeemed' });
  assert.deepEqual(codeRow(db, 'CODE-FULL'), before, 'every column back to its pre-revoke value');
  assert.equal((await call(env, 'GET', '/profile', { token: TOKENS.full })).status, 200, 'user has access again');
});

test('revoke then un-revoke a never-redeemed code: back to unused, and it can be redeemed again', async () => {
  const { db, env } = setup();
  const before = codeRow(db, 'CODE-UNUSED');
  await revoke(env, 'CODE-UNUSED');
  assert.equal((await call(env, 'POST', '/redeem', { body: { code: 'CODE-UNUSED' } })).status, 403, 'revoked: cannot redeem');

  const res = await unrevoke(env, 'CODE-UNUSED');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, status: 'unused' });
  assert.deepEqual(codeRow(db, 'CODE-UNUSED'), before, 'note, expiry and every other column untouched');

  const redeemed = await call(env, 'POST', '/redeem', { body: { code: 'CODE-UNUSED' } });
  assert.equal(redeemed.status, 200, 'redeemable again');
  assert.ok(redeemed.json.token);
});

test('un-revoke restores a code that was already revoked in the data (not just one revoked in this test)', async () => {
  const { db, env } = setup();
  assert.equal((await call(env, 'GET', '/profile', { token: TOKENS.revoked })).status === 200, false);
  const res = await unrevoke(env, 'CODE-REVOKED');
  assert.equal(res.status, 200);
  assert.equal(codeRow(db, 'CODE-REVOKED').status, 'redeemed');
  assert.equal(codeRow(db, 'CODE-REVOKED').redeemed_by, USERS.revoked);
  assert.equal((await call(env, 'GET', '/profile', { token: TOKENS.revoked })).status, 200);
});

// ---- Refund revokes stay revoked ------------------------------------------------------------------

function addClaim(db, code, claimType, status) {
  db.prepare(`INSERT INTO refund_claims (id, code, email, claim_type, status, refund_cents, created_at)
    VALUES (?, ?, 'buyer@example.com', ?, ?, 3699, 1789000000)`).run(`claim-${code}-${claimType}-${status}`, code, claimType, status);
}

test('a code revoked by a refunded 7-day claim is NOT un-revoked (409 code_refunded, user stays locked out)', async () => {
  const { db, env } = setup();
  addClaim(db, 'CODE-FULL', 'unconditional_7day', 'refunded');
  await revoke(env, 'CODE-FULL');
  const res = await unrevoke(env, 'CODE-FULL');
  assert.equal(res.status, 409);
  assert.equal(res.json.error, 'code_refunded');
  assert.equal(codeRow(db, 'CODE-FULL').status, 'revoked');
  assert.notEqual((await call(env, 'GET', '/profile', { token: TOKENS.full })).status, 200);
});

test('guard: claims that never revoke (pending/denied 7-day, refunded exam-failure) do not block un-revoke', async () => {
  const { db, env } = setup();
  addClaim(db, 'CODE-FULL', 'unconditional_7day', 'pending');
  addClaim(db, 'CODE-FULL', 'unconditional_7day', 'denied');
  addClaim(db, 'CODE-FULL', 'exam_failure_50pct', 'refunded');
  await revoke(env, 'CODE-FULL');
  const res = await unrevoke(env, 'CODE-FULL');
  assert.equal(res.status, 200);
  assert.equal(codeRow(db, 'CODE-FULL').status, 'redeemed');
});

// ---- Bad requests change nothing ------------------------------------------------------------------

test('un-revoking a code that is not revoked is refused (409 not_revoked) and changes nothing', async () => {
  const { db, env } = setup();
  for (const code of ['CODE-FULL', 'CODE-UNUSED']) {
    const before = codeRow(db, code);
    const res = await unrevoke(env, code);
    assert.equal(res.status, 409, code);
    assert.equal(res.json.error, 'not_revoked');
    assert.deepEqual(codeRow(db, code), before);
  }
});

test('unknown code -> 404 code_not_found; missing code -> 400 code_required', async () => {
  const { env } = setup();
  const unknown = await unrevoke(env, 'NOPE-00000');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error, 'code_not_found');
  const missing = await asAdmin(env, 'POST', '/console/codes/unrevoke', {});
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error, 'code_required');
});

// ---- Only an admin can un-revoke ------------------------------------------------------------------

test('un-revoke rejects anonymous callers, forged Access tokens, and customer logins -- and changes nothing', async () => {
  const { db, env } = setup();
  const attempts = [
    await call(env, 'POST', '/console/codes/unrevoke', { body: { code: 'CODE-REVOKED' } }),
    await call(env, 'POST', '/console/codes/unrevoke', { body: { code: 'CODE-REVOKED' }, headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' } }),
    await call(env, 'POST', '/console/codes/unrevoke', { body: { code: 'CODE-REVOKED' }, token: TOKENS.revoked }),
    await call(env, 'POST', '/console/codes/unrevoke', { body: { code: 'CODE-REVOKED' }, token: TOKENS.full }),
  ];
  for (const r of attempts) assert.equal(r.status, 401);
  assert.equal(codeRow(db, 'CODE-REVOKED').status, 'revoked');
});
