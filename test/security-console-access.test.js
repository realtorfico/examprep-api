// SECURITY: the admin API (/console/*) can read and edit the entire question bank, resources, codes,
// and customer data. Every one of its routes must reject anything but a genuine Cloudflare Access login.
// Written 2026-09-16 as part of the paid-content audit -- verified correct then (live: no header and a
// forged header both 401), so these are regression guards.
//
// Routes are read from the router source, so a new /console route is covered automatically. Access
// JWTs are real RS256 tokens signed with keys generated here; the Access certs endpoint is stubbed to
// serve the "real" public key, so a token signed with any other key must fail signature verification.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDb, makeEnv, call } from './_harness.js';
import { seedPaidContent, assertNoPaidMarkers } from './_paid-content-fixture.js';

const TEAM = 'team.example.cloudflareaccess.com';
const AUD = 'test-aud-123';
const KID = 'test-kid-1';

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(Buffer.from(JSON.stringify(obj)));

async function makeKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
}
async function signJwt(privateKey, payload, kid = KID) {
  const head = b64urlJson({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64urlJson(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const realKeys = await makeKeyPair();
const attackerKeys = await makeKeyPair();
const realJwk = { ...(await crypto.subtle.exportKey('jwk', realKeys.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

// The Worker caches the certs for its lifetime, so this stub stays installed for the whole file.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [realJwk] }));
  return realFetch(url, init);
};

function consoleRoutes() {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const router = src.slice(src.indexOf('export default {'));
  const start = router.indexOf("pathname.startsWith('/console/')");
  const block = router.slice(start, router.indexOf('// Everything else requires a valid bearer token.', start));
  return [...block.matchAll(/pathname === '(\/console\/[^']+)' && method === '([A-Z]+)'/g)].map((m) => [m[2], m[1]]);
}

function setup(envExtra = {}) {
  const db = makeDb();
  seedPaidContent(db);
  return Object.assign(makeEnv(db), { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD }, envExtra);
}

const now = () => Math.floor(Date.now() / 1000);
const validPayload = () => ({ aud: [AUD], email: 'admin@example.com', exp: now() + 3600, iss: `https://${TEAM}` });

async function assertAllConsoleRoutesReject(env, headers, label) {
  const routes = consoleRoutes();
  assert.ok(routes.length >= 40, `router parse looks wrong, found only ${routes.length} console routes`);
  const accepted = [];
  for (const [method, path] of routes) {
    const res = await call(env, method, path + (method === 'GET' ? '?examType=ca_cdl' : ''), { headers, body: method === 'POST' ? {} : undefined });
    if (res.status !== 401) accepted.push(`${method} ${path} -> ${res.status}`);
    assertNoPaidMarkers(assert, res.text, `${label}: ${method} ${path}`);
  }
  assert.deepEqual(accepted, [], `${label}: console routes that did not reject:\n  ${accepted.join('\n  ')}`);
}

test('every /console route rejects a request with no Access login', async () => {
  await assertAllConsoleRoutesReject(setup(), {}, 'no header');
});

test('every /console route rejects a token signed with the wrong key (forged)', async () => {
  const forged = await signJwt(attackerKeys.privateKey, validPayload());
  await assertAllConsoleRoutesReject(setup(), { 'Cf-Access-Jwt-Assertion': forged }, 'forged signature');
});

test('every /console route rejects an unsigned token (alg none) and garbage', async () => {
  const unsigned = `${b64urlJson({ alg: 'none', kid: KID })}.${b64urlJson(validPayload())}.`;
  await assertAllConsoleRoutesReject(setup(), { 'Cf-Access-Jwt-Assertion': unsigned }, 'alg none');
  await assertAllConsoleRoutesReject(setup(), { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' }, 'garbage');
});

test('every /console route rejects a real-key token for the wrong application (aud) or that has expired', async () => {
  const wrongAud = await signJwt(realKeys.privateKey, { ...validPayload(), aud: ['some-other-app'] });
  await assertAllConsoleRoutesReject(setup(), { 'Cf-Access-Jwt-Assertion': wrongAud }, 'wrong aud');
  const expired = await signJwt(realKeys.privateKey, { ...validPayload(), exp: now() - 60 });
  await assertAllConsoleRoutesReject(setup(), { 'Cf-Access-Jwt-Assertion': expired }, 'expired');
});

test('console fails closed when Access isn\'t configured, even with an otherwise valid token', async () => {
  const valid = await signJwt(realKeys.privateKey, validPayload());
  await assertAllConsoleRoutesReject(setup({ CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: undefined }),
    { 'Cf-Access-Jwt-Assertion': valid }, 'unconfigured');
});

test('console rejects a valid token whose email is not on the allowlist, when one is set', async () => {
  const valid = await signJwt(realKeys.privateKey, validPayload());
  await assertAllConsoleRoutesReject(setup({ CF_ACCESS_ALLOWED_EMAILS: 'owner@example.com' }),
    { 'Cf-Access-Jwt-Assertion': valid }, 'email not allowlisted');
});

test('a genuine Access login CAN read the question bank (proves the rejections above are real, not a broken harness)', async () => {
  const valid = await signJwt(realKeys.privateKey, validPayload());
  const res = await call(setup(), 'GET', '/console/questions?examType=ca_cdl', { headers: { 'Cf-Access-Jwt-Assertion': valid } });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('PAID-QUESTION'), 'admin sees the full bank');
});

test('admin Alerts tab offers the refused-access alert, so its recipients can be managed there', async () => {
  const valid = await signJwt(realKeys.privateKey, validPayload());
  const res = await call(setup(), 'GET', '/console/alert-rules', { headers: { 'Cf-Access-Jwt-Assertion': valid } });
  assert.equal(res.status, 200);
  assert.ok(res.json.triggers.some((t) => t.key === 'access_denied'), 'access_denied must be a manageable alert trigger');
});
