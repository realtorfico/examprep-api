// POST /study-link -- the CDL pages' "email me the free practice link" capture (phase 1 of the CDL email
// capture, 2026-09-18). A visitor on /cdl or a /cdl/{state} track page leaves an email and gets ONE
// email back with a link to their state's free sample questions and the track page. An unticked-by-
// default checkbox records separate consent for occasional study tips and offers; nothing sends those
// yet (phase 2 is the promo pipeline with unsubscribe + postal address), this only stores the consent.
//
// What these guard:
//   - the email's links are built server-side from track_registry, never from anything the client
//     sends -- this endpoint emails an arbitrary address, so a client-supplied URL would make it a
//     phishing relay with our domain on it;
//   - consent is recorded exactly as given (off unless ticked, latest answer wins, with when and the
//     wording agreed to);
//   - it can't be used to flood an inbox: Turnstile, one email per address+track per day, and at
//     most three a day to one address across tracks;
//   - CDL only, active tracks only.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, call } from './_harness.js';

const CDL = 'Commercial Driver (CDL)';

function seed() {
  const db = makeDb();
  const ins = db.prepare(`INSERT INTO track_registry (exam_type, kind, state_code, short_name, active, is_exam_required,
    exam_question_count, exam_duration_sec, pass_percent, min_correct, mechanics_note, updated_at) VALUES (?,?,?,?,?,1,50,3600,80,40,NULL,0)`);
  ins.run('tx_cdl', CDL, 'TX', 'Texas CDL', 1);
  ins.run('ca_cdl', CDL, 'CA', 'California CDL', 1);
  ins.run('fl_cdl', CDL, 'FL', 'Florida CDL', 1);
  ins.run('ny_cdl', CDL, 'NY', 'New York CDL', 1);
  ins.run('zz_cdl', CDL, 'ZZ', 'Retired CDL', 0);
  ins.run('ca_notary', 'Notary', 'CA', 'California Notary', 1);
  return db;
}

// Captures every Resend send and every Turnstile verify; everything else 404s.
function stubFetch({ resendFails = false, turnstileSuccess = true } = {}) {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href === 'https://api.resend.com/emails') {
      if (resendFails) return { ok: false, status: 500, json: async () => ({ message: 'boom' }) };
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'email_' + sent.length }) };
    }
    if (href.startsWith('https://challenges.cloudflare.com/turnstile/')) {
      return { ok: true, status: 200, json: async () => ({ success: turnstileSuccess }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { sent, restore() { globalThis.fetch = original; } };
}

function body(overrides) {
  return { email: 'Driver@Example.com ', examType: 'tx_cdl', source: 'track_card', marketingOptIn: false, turnstileToken: 'tok', ...overrides };
}

const rows = (db) => db.prepare('SELECT * FROM study_link_requests ORDER BY created_at, exam_type').all();

test('a valid request stores the lead and emails links built from the registry', async (t) => {
  const db = seed();
  const env = makeEnv(db);
  const f = stubFetch();
  t.after(() => f.restore());

  const res = await call(env, 'POST', '/study-link', { body: body({ source: 'category_card' }) });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });

  const [row] = rows(db);
  assert.equal(row.email, 'driver@example.com', 'trimmed and lowercased');
  assert.equal(row.exam_type, 'tx_cdl');
  assert.equal(row.source, 'category_card');
  assert.equal(row.marketing_opt_in, 0);
  assert.equal(row.opt_in_at, null);
  assert.ok(row.sent_at, 'sent_at recorded');

  assert.equal(f.sent.length, 1);
  const mail = f.sent[0];
  assert.equal(mail.to, 'driver@example.com');
  assert.match(mail.subject, /Texas CDL/);
  assert.ok(mail.html.includes('href="https://passexamhq.com/cdl/tx#/sample"'), 'links the state sample');
  assert.ok(mail.html.includes('href="https://passexamhq.com/cdl/tx"'), 'links the track page');
});

test('links never come from the request, whatever it sends', async (t) => {
  const db = seed();
  const env = makeEnv(db);
  const f = stubFetch();
  t.after(() => f.restore());

  await call(env, 'POST', '/study-link', { body: body({ url: 'https://evil.example/', sampleUrl: 'https://evil.example/', trackName: '<b>Win</b>' }) });
  assert.equal(f.sent.length, 1);
  assert.ok(!f.sent[0].html.includes('evil.example'));
  assert.ok(!f.sent[0].html.includes('<b>Win</b>'));
});

test('consent is off unless ticked, records when and what, and the latest answer wins', async (t) => {
  const db = seed();
  const env = makeEnv(db);
  const f = stubFetch();
  t.after(() => f.restore());

  await call(env, 'POST', '/study-link', { body: body({ marketingOptIn: true }) });
  let [row] = rows(db);
  assert.equal(row.marketing_opt_in, 1);
  assert.ok(row.opt_in_at > 0);
  assert.match(row.opt_in_text, /study tips and offers/);

  await call(env, 'POST', '/study-link', { body: body({ marketingOptIn: false }) });
  [row] = rows(db);
  assert.equal(row.marketing_opt_in, 0, 'unticking on a later request withdraws it');
  assert.equal(row.opt_in_at, null);
  assert.equal(row.opt_in_text, null);

  // A truthy non-boolean is not consent.
  await call(env, 'POST', '/study-link', { body: body({ email: 'other@example.com', marketingOptIn: 'yes' }) });
  const other = rows(db).find((r) => r.email === 'other@example.com');
  assert.equal(other.marketing_opt_in, 0);
});

test('rejects bad input without storing or sending anything', async (t) => {
  const db = seed();
  const env = makeEnv(db);
  const f = stubFetch();
  t.after(() => f.restore());

  const cases = [
    [body({ email: '' }), 'invalid_email'],
    [body({ email: 'not-an-email' }), 'invalid_email'],
    [body({ email: 'a@b.c'.padStart(300, 'x') }), 'invalid_email'],
    [body({ examType: '' }), 'invalid_examType'],
    [body({ examType: 'nope_cdl' }), 'invalid_examType'],
    [body({ examType: 'zz_cdl' }), 'invalid_examType'],
    [body({ examType: 'ca_notary' }), 'not_offered'],
    [body({ source: 'buy_page' }), 'invalid_source'],
    [body({ source: undefined }), 'invalid_source'],
  ];
  for (const [b, error] of cases) {
    const res = await call(env, 'POST', '/study-link', { body: b });
    assert.equal(res.status, 400, JSON.stringify(b));
    assert.equal(res.json.error, error, JSON.stringify(b));
  }
  assert.equal(rows(db).length, 0);
  assert.equal(f.sent.length, 0);
});

test('Turnstile is required once it is configured', async (t) => {
  const db = seed();
  const env = { ...makeEnv(db), TURNSTILE_SECRET: 'secret' };
  const f = stubFetch({ turnstileSuccess: false });
  t.after(() => f.restore());

  const res = await call(env, 'POST', '/study-link', { body: body() });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'turnstile_failed');
  const missing = await call(env, 'POST', '/study-link', { body: body({ turnstileToken: undefined }) });
  assert.equal(missing.status, 400);
  assert.equal(rows(db).length, 0);
  assert.equal(f.sent.length, 0);
});

test('one email per address and track per day; a repeat still updates the lead', async (t) => {
  const db = seed();
  const env = makeEnv(db);
  const f = stubFetch();
  t.after(() => f.restore());

  await call(env, 'POST', '/study-link', { body: body({ source: 'track_card' }) });
  const again = await call(env, 'POST', '/study-link', { body: body({ source: 'track_exit', marketingOptIn: true }) });
  assert.equal(again.status, 200);
  assert.equal(f.sent.length, 1, 'no second email within a day');
  const [row] = rows(db);
  assert.equal(row.source, 'track_exit');
  assert.equal(row.marketing_opt_in, 1);

  // A day later the same request sends again.
  db.prepare('UPDATE study_link_requests SET sent_at = sent_at - 90000').run();
  await call(env, 'POST', '/study-link', { body: body() });
  assert.equal(f.sent.length, 2);
});

test('at most three emails a day to one address across tracks', async (t) => {
  const db = seed();
  const env = makeEnv(db);
  const f = stubFetch();
  t.after(() => f.restore());

  for (const examType of ['tx_cdl', 'ca_cdl', 'fl_cdl', 'ny_cdl']) {
    const res = await call(env, 'POST', '/study-link', { body: body({ examType }) });
    assert.equal(res.status, 200);
  }
  assert.equal(f.sent.length, 3);
  assert.equal(rows(db).length, 4, 'the fourth is still recorded, just not emailed');
  assert.equal(rows(db).filter((r) => r.sent_at == null).length, 1);
});

test('a failed send is reported, and the lead is kept unsent so a retry sends it', async (t) => {
  const db = seed();
  const env = makeEnv(db);
  let f = stubFetch({ resendFails: true });

  const res = await call(env, 'POST', '/study-link', { body: body() });
  assert.equal(res.status, 502);
  assert.equal(res.json.error, 'send_failed');
  assert.equal(rows(db)[0].sent_at, null);
  f.restore();

  f = stubFetch();
  t.after(() => f.restore());
  const retry = await call(env, 'POST', '/study-link', { body: body() });
  assert.equal(retry.status, 200);
  assert.equal(f.sent.length, 1);
});

test('the admin list shows leads newest first, filters opted-in only and by age', async () => {
  const { handleConsoleStudyLinkRequestsList } = await import('../src/index.js');
  const db = seed();
  const env = makeEnv(db);
  const nowSec = Math.floor(Date.now() / 1000);
  const ins = db.prepare(`INSERT INTO study_link_requests (id, email, exam_type, source, marketing_opt_in, opt_in_at, opt_in_text,
    created_at, updated_at, sent_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  ins.run('1', 'old@example.com', 'tx_cdl', 'track_card', 1, nowSec - 200 * 86400, 'x', nowSec - 200 * 86400, nowSec - 200 * 86400, nowSec - 200 * 86400);
  ins.run('2', 'yes@example.com', 'ca_cdl', 'category_card', 1, nowSec - 100, 'x', nowSec - 100, nowSec - 100, nowSec - 100);
  ins.run('3', 'no@example.com', 'fl_cdl', 'track_exit', 0, null, null, nowSec - 50, nowSec - 50, null);

  const list = async (qs) => (await handleConsoleStudyLinkRequestsList(new Request('https://api.example.com/console/study-link-requests' + qs), env)).json();
  assert.deepEqual((await list('?days=90')).items.map((r) => r.email), ['no@example.com', 'yes@example.com']);
  assert.deepEqual((await list('?days=90&optIn=yes')).items.map((r) => r.email), ['yes@example.com']);
  assert.deepEqual((await list('?days=365')).items.map((r) => r.email), ['no@example.com', 'yes@example.com', 'old@example.com']);
});
