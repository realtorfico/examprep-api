// GUARD: on every track sold by topic (à la carte -- any track with track_key_breakdown rows), each
// question's and each resource's topic must be one of that track's sellable topics (or, for resources,
// "General Reference"). Anything else is silently broken for buyers: a question with a stale topic is
// never served to a topic buyer, and a resource with a stale topic is locked even for buyers of the
// topic it belongs to.
//
// Added 2026-09-16 after finding 10 paid resources on 5 live tracks (dat, oat, la_cdl, ia_cdl, nm_cdl)
// still tagged with pre-relabel topic names: the à la carte rollout checked questions for "orphans"
// but never checked resources. The daily health check (cron) now looks for both and emails the
// 'health_check_failed' recipients, so a future relabel that misses something gets caught within a day.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeDb, makeEnv } from './_harness.js';
import { seedPaidContent } from './_paid-content-fixture.js';

const emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (href === 'https://api.resend.com/emails') {
    emails.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'e' }), { status: 200 });
  }
  if (href.startsWith('https://api.stripe.com/v1/balance')) return new Response(JSON.stringify({ object: 'balance' }), { status: 200 });
  return realFetch(url, init);
};

function setup() {
  emails.length = 0;
  const db = makeDb();
  seedPaidContent(db);
  db.prepare(`INSERT INTO admin_alert_rules (id, trigger_key, recipient_email, active, created_at, updated_at)
    VALUES ('rule-hc', 'health_check_failed', 'owner@example.com', 1, 0, 0)`).run();
  // Every secret the health check looks for is present and Stripe answers OK, so the only thing that
  // can make it alert in these tests is the topic check.
  const env = Object.assign(makeEnv(db), {
    STRIPE_SECRET_KEY: 'sk_test', TURNSTILE_SECRET: 't', RESEND_API_KEY: 'r', MEDIA_SIGNING_SECRET: 'm',
  });
  return { db, env };
}

async function runDailyCron(env) {
  const pending = [];
  await worker.scheduled({ cron: '0 13 * * *' }, env, { waitUntil: (p) => pending.push(p) });
  await Promise.allSettled(pending);
  return emails.filter((e) => /health check/i.test(e.subject));
}

test('healthy topic tags: the daily check sends no alert (tracks not sold by topic are not checked)', async () => {
  const { env } = setup(); // tx_notary has no breakdown rows and its topics aren't breakdown labels -- must be ignored
  const alerts = await runDailyCron(env);
  assert.equal(alerts.length, 0, alerts.length ? JSON.stringify(alerts[0].html).slice(0, 300) : '');
});

test('a resource tagged with a topic that is not one of its track\'s sellable topics triggers the daily alert', async () => {
  const { db, env } = setup();
  db.prepare(`INSERT INTO resources (id, exam_type, ord, type, title, desc, topic, free, downloadable, data_json, created_at, updated_at)
    VALUES ('ca_cdl:stale-tag', 'ca_cdl', 50, 'table', 'Stale Tag Table', 'd', 'Biology', 0, 0, '{"headers":[],"rows":[]}', 0, 0)`).run();
  const alerts = await runDailyCron(env);
  assert.equal(alerts.length, 1, 'expected one health-check alert');
  assert.match(alerts[0].html, /ca_cdl:stale-tag/);
  assert.match(alerts[0].html, /Biology/);
});

test('a question tagged with a topic that is not one of its track\'s sellable topics triggers the daily alert', async () => {
  const { db, env } = setup();
  db.prepare(`INSERT INTO questions (id, exam_type, topic, question, choice_a, choice_b, choice_c, choice_d, correct_choice, explanation, weight, created_at)
    VALUES ('ca_cdl-orphan-1', 'ca_cdl', 'Old Topic Name', 'q', 'a', 'b', 'c', 'd', 'A', 'e', 3, 0)`).run();
  const alerts = await runDailyCron(env);
  assert.equal(alerts.length, 1, 'expected one health-check alert');
  assert.match(alerts[0].html, /ca_cdl/);
  assert.match(alerts[0].html, /Old Topic Name/);
});

test('"General Reference" is a valid resource tag on a topic-sold track (no alert)', async () => {
  const { env } = setup(); // the fixture already has paid General Reference resources on ca_cdl
  assert.equal((await runDailyCron(env)).length, 0);
});
