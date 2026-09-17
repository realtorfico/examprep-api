// MONITORING: every refused attempt to reach content without the right access is recorded, and the owner
// is emailed when it happens -- so a probe or exploit attempt no longer goes unnoticed. Added 2026-09-16:
// the paid-content audit found holes that could have been exploited for weeks with no record anywhere.
//
// Recorded in `access_denials` (kind, user_id, exam_type, detail, path, ip, created_at). Kinds:
// - answer_foreign_question / answer_unowned_topic / sign_batch_foreign_file: a LOGGED-IN account asked for
//   something outside what it bought. The real site never does this, so ONE is worth an email.
// - console_auth_failed / media_bad_signature / mcp_grade_not_public: anonymous probes. Scanners and stale
//   AI-assistant conversations produce some noise, so these email only past a threshold per hour.
// Emails go to admin_alert_rules recipients for trigger 'access_denied', at most one per group per hour.
// An EXPIRED media link is normal (a tab left open past an hour) and is not recorded.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, call, mcp } from './_harness.js';
import { seedPaidContent, TOKENS, USERS } from './_paid-content-fixture.js';
import { signMediaUrl } from '../src/lib/mediaSign.js';

const ANONYMOUS_ALERT_THRESHOLD = 20;

// Captures emails the Worker tries to send through Resend.
const emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === 'https://api.resend.com/emails') {
    emails.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'email-' + emails.length }), { status: 200 });
  }
  return realFetch(url, init);
};

function setup() {
  emails.length = 0;
  const db = makeDb();
  seedPaidContent(db);
  db.prepare(`INSERT INTO admin_alert_rules (id, trigger_key, recipient_email, active, created_at, updated_at)
    VALUES ('rule-1', 'access_denied', 'owner@example.com', 1, 0, 0)`).run();
  const env = makeEnv(db);
  env.RESEND_API_KEY = 'test-resend-key';
  env.MEDIA = {
    head: async () => ({ size: 10 }),
    get: async () => ({ body: 'bytes', writeHttpMetadata() {}, httpEtag: '"e"' }),
  };
  return { db, env };
}
const denials = (db, kind) => db.prepare('SELECT * FROM access_denials WHERE kind = ? ORDER BY created_at').all(kind);
const alertEmails = () => emails.filter((e) => e.to === 'owner@example.com' && /access/i.test(e.subject));

// ---- What gets recorded -------------------------------------------------------------------------

test('records a logged-in account answering a question from a track it did not buy', async () => {
  const { db, env } = setup();
  await call(env, 'POST', '/answer', { token: TOKENS.notary, body: { questionId: 'ca_cdl-b1-101', choice: 'A' } });
  const rows = denials(db, 'answer_foreign_question');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USERS.notary);
  assert.equal(rows[0].exam_type, 'tx_notary');
  assert.match(rows[0].detail, /ca_cdl-b1-101/);
  assert.equal(rows[0].path, '/answer');
});

test('records an à la carte account answering an un-owned topic question', async () => {
  const { db, env } = setup();
  await call(env, 'POST', '/answer', { token: TOKENS.topic, body: { questionId: 'ca_cdl-b1-201', choice: 'A' } });
  const rows = denials(db, 'answer_unowned_topic');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USERS.topic);
  assert.match(rows[0].detail, /ca_cdl-b1-201/);
});

test('records a logged-in account asking to sign another track\'s media file', async () => {
  const { db, env } = setup();
  await call(env, 'POST', '/resources/sign-batch', { token: TOKENS.notary, body: { files: ['paid-owned.m4a'] } });
  const rows = denials(db, 'sign_batch_foreign_file');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USERS.notary);
  assert.match(rows[0].detail, /paid-owned\.m4a/);
});

test('records media requests with a missing or forged signature -- but not an expired one', async () => {
  const { db, env } = setup();
  await call(env, 'GET', '/media/paid-owned.m4a');
  await call(env, 'GET', '/media/paid-owned.m4a?exp=9999999999&sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  const expired = await signMediaUrl(env, 'paid-owned.m4a', -60);
  await call(env, 'GET', `/media/paid-owned.m4a?exp=${expired.exp}&sig=${expired.sig}`);
  assert.equal(denials(db, 'media_bad_signature').length, 2, 'missing + forged recorded, expired not');
});

test('records failed admin (/console) logins', async () => {
  const { db, env } = setup();
  env.CF_ACCESS_TEAM_DOMAIN = 'team.example.com';
  env.CF_ACCESS_AUD = 'aud';
  await call(env, 'GET', '/console/questions?examType=ca_cdl');
  await call(env, 'GET', '/console/questions?examType=ca_cdl', { headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' } });
  const rows = denials(db, 'console_auth_failed');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].path, '/console/questions');
});

test('records public AI-assistant grading of a question outside the public set', async () => {
  const { db, env } = setup();
  await mcp(env, 'grade_practice_answer', { questionId: 'tx_notary-b2-100', response: 'A' });
  const rows = denials(db, 'mcp_grade_not_public');
  assert.equal(rows.length, 1);
  assert.match(rows[0].detail, /tx_notary-b2-100/);
});

test('normal use records nothing and sends no alerts', async () => {
  const { db, env } = setup();
  await call(env, 'POST', '/answer', { token: TOKENS.full, body: { questionId: 'ca_cdl-b1-201', choice: 'A' } });
  await call(env, 'POST', '/answer', { token: TOKENS.topic, body: { questionId: 'ca_cdl-b1-101', choice: 'A' } });
  await call(env, 'GET', '/progress', { token: TOKENS.full });
  await call(env, 'GET', '/questions/next', { token: TOKENS.topic });
  await call(env, 'POST', '/resources/sign-batch', { token: TOKENS.full, body: { files: ['paid-owned.m4a'] } });
  await call(env, 'GET', '/sample?examType=ca_cdl');
  await call(env, 'GET', '/qotd?examType=ca_cdl');
  await mcp(env, 'grade_practice_answer', { questionId: 'ca_cdl-b1-001', response: 'A' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_denials').get().n, 0);
  assert.equal(alertEmails().length, 0);
});

// ---- Alerts -------------------------------------------------------------------------------------

test('alerts the owner on the FIRST logged-in account denial, then at most once an hour', async () => {
  const { env } = setup();
  await call(env, 'POST', '/answer', { token: TOKENS.notary, body: { questionId: 'ca_cdl-b1-101', choice: 'A' } });
  assert.equal(alertEmails().length, 1, 'one denial by a logged-in account is enough to alert');
  assert.match(JSON.stringify(alertEmails()[0]), /answer_foreign_question/);
  for (let i = 102; i <= 105; i++) {
    await call(env, 'POST', '/answer', { token: TOKENS.notary, body: { questionId: `ca_cdl-b1-${i}`, choice: 'A' } });
  }
  assert.equal(alertEmails().length, 1, 'no repeat email within the hour');
});

test('alerts on anonymous probes only past the hourly threshold, then at most once an hour', async () => {
  const { env } = setup();
  for (let i = 1; i < ANONYMOUS_ALERT_THRESHOLD; i++) await call(env, 'GET', '/media/paid-owned.m4a');
  assert.equal(alertEmails().length, 0, `${ANONYMOUS_ALERT_THRESHOLD - 1} anonymous denials in an hour: no email yet`);
  await call(env, 'GET', '/media/paid-owned.m4a');
  assert.equal(alertEmails().length, 1, `the ${ANONYMOUS_ALERT_THRESHOLD}th in an hour triggers one email`);
  for (let i = 0; i < 10; i++) await call(env, 'GET', '/media/paid-owned.m4a');
  assert.equal(alertEmails().length, 1, 'no repeat email within the hour');
});

test('an anonymous-probe email within the hour does not suppress a logged-in account alert', async () => {
  const { env } = setup();
  for (let i = 0; i < ANONYMOUS_ALERT_THRESHOLD; i++) await call(env, 'GET', '/media/paid-owned.m4a');
  assert.equal(alertEmails().length, 1);
  await call(env, 'POST', '/answer', { token: TOKENS.notary, body: { questionId: 'ca_cdl-b1-101', choice: 'A' } });
  assert.equal(alertEmails().length, 2, 'account-level denials alert separately');
});

test('a failure to record or email never breaks the actual request', async () => {
  const { db, env } = setup();
  db.exec('DROP TABLE access_denials');
  const res = await call(env, 'POST', '/answer', { token: TOKENS.notary, body: { questionId: 'ca_cdl-b1-101', choice: 'A' } });
  assert.equal(res.status, 404, 'still a clean refusal, not a 500');
});
