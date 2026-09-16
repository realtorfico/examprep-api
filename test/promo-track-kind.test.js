// Track-kind-scoped promotions (promotions.required_track_kind, added 2026-09-16 for the
// "20% off CDL for first-time customers" code). Covers:
// 1. A CDL-scoped, first-purchase-only percent code discounts a full CDL checkout for a new email,
//    and the confirm step accepts exactly that discounted amount.
// 2. The same code is rejected (promo_wrong_track_kind) on a different kind's checkout.
// 3. The same code is rejected (promo_not_first_purchase) once the email already has a codes row.
// 4. An à la carte topic purchase is never discounted, even with the code sent along.
// 5. /promotions only lists a kind-scoped promo when the caller passes that same ?kind=.
//
// Stripe is mocked via a global fetch stub (same approach as ala-carte-checkout.test.js).
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleStripeCreateIntent, handleStripeConfirm, handlePromotionsList, _resetTrackRegistryCacheForTests } from '../src/index.js';

const CDL_KIND = 'Commercial Driver (CDL)';
const CODE = 'NEWCDL20';

function makeD1(db) {
  function prepare(sql) {
    const stmt = db.prepare(sql);
    const bound = (args) => ({
      first: async () => stmt.get(...args) ?? null,
      all: async () => ({ results: stmt.all(...args) }),
      run: async () => { const r = stmt.run(...args); return { meta: { changes: r.changes } }; },
      _runSync: () => stmt.run(...args),
    });
    return { ...bound([]), bind: (...args) => bound(args) };
  }
  return {
    prepare,
    async batch(statements) {
      return statements.map((s) => s._runSync());
    },
  };
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE track_registry (exam_type TEXT PRIMARY KEY, kind TEXT, state_code TEXT, short_name TEXT,
      active INTEGER, is_exam_required INTEGER, exam_question_count INTEGER, exam_duration_sec INTEGER,
      pass_percent INTEGER, min_correct INTEGER, mechanics_note TEXT, updated_at INTEGER);
    CREATE TABLE pricing (exam_type TEXT PRIMARY KEY, price_cents INTEGER, currency TEXT);
    CREATE TABLE track_key_breakdown (id TEXT PRIMARY KEY, exam_type TEXT NOT NULL, label TEXT NOT NULL,
      declared_pct INTEGER NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
    CREATE TABLE pending_topic_purchases (order_id TEXT PRIMARY KEY, exam_type TEXT NOT NULL, topics_json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE pending_point_discounts (order_id TEXT PRIMARY KEY, email TEXT, points_to_apply INTEGER, created_at INTEGER);
    CREATE TABLE pending_promo_discounts (order_id TEXT PRIMARY KEY, promo_id TEXT, code TEXT, discount_cents INTEGER, created_at INTEGER);
    CREATE TABLE checkout_intents (id TEXT PRIMARY KEY, email TEXT, exam_type TEXT, created_at INTEGER,
      purchased_at INTEGER, reminder_sent_at INTEGER, source TEXT, UNIQUE(email, exam_type));
    CREATE TABLE codes (code TEXT PRIMARY KEY, exam_type TEXT, status TEXT, note TEXT, expires_at INTEGER,
      redeemed_by TEXT, redeemed_at INTEGER, issued_at INTEGER, paid_cents INTEGER, buyer_email TEXT, referral_source TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, exam_type TEXT, token TEXT, created_at INTEGER, last_seen_at INTEGER,
      age_category TEXT, owned_topics_json TEXT);
    CREATE TABLE referrals (id TEXT PRIMARY KEY, referred_email_normalized TEXT, status TEXT, converted_at INTEGER,
      referrer_account_id TEXT, referred_email TEXT, verify_token TEXT, created_at INTEGER);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT, points INTEGER, points_multiplier REAL, points_multiplier_expires_at INTEGER);
    CREATE TABLE admin_alert_rules (trigger_key TEXT, recipient_email TEXT, active INTEGER);
    CREATE TABLE funnel_events (id TEXT PRIMARY KEY, session_id TEXT, visitor_id TEXT, event_name TEXT, exam_type TEXT, variant TEXT, created_at INTEGER);
    CREATE TABLE promotions (
      id TEXT PRIMARY KEY, title TEXT, body TEXT, cta_label TEXT, cta_url TEXT, promo_code TEXT,
      discount_type TEXT, discount_value INTEGER, required_email_domain TEXT,
      require_email_verification INTEGER DEFAULT 0, first_purchase_only INTEGER DEFAULT 0,
      required_track_kind TEXT,
      points_multiplier INTEGER, points_multiplier_days INTEGER, placement TEXT DEFAULT 'both',
      active INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, redeemed_count INTEGER DEFAULT 0,
      starts_at INTEGER, ends_at INTEGER, created_at INTEGER
    );
    CREATE TABLE point_rules (task_key TEXT PRIMARY KEY, points INTEGER, active INTEGER);
  `);
  db.prepare(`INSERT INTO track_registry VALUES ('ca_cdl', ?, 'CA', 'CA CDL', 1, 1, 50, 3600, 80, 40, NULL, 0)`).run(CDL_KIND);
  db.prepare(`INSERT INTO track_registry VALUES ('ca_notary', 'Notary', 'CA', 'CA Notary', 1, 1, 45, 3600, 70, 32, NULL, 0)`).run();
  db.prepare(`INSERT INTO pricing VALUES ('ca_cdl', 3699, 'USD')`).run();
  db.prepare(`INSERT INTO pricing VALUES ('ca_notary', 2999, 'USD')`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-1', 'ca_cdl', 'General Knowledge (CDL Rules, Safe Driving & Cargo)', 48, 0)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-2', 'ca_cdl', 'Air Brakes, Combination Vehicles & Doubles/Triples', 52, 1)`).run();
  db.prepare(
    `INSERT INTO promotions (id, title, body, promo_code, discount_type, discount_value, first_purchase_only,
       required_track_kind, placement, active, sort_order, created_at)
     VALUES ('promo-cdl', 'CDL 20', 'body', ?, 'percent', 20, 1, ?, 'both', 1, -1, 0)`
  ).run(CODE, CDL_KIND);
  db.prepare(
    `INSERT INTO promotions (id, title, body, required_email_domain, discount_type, discount_value, placement, active, sort_order, created_at)
     VALUES ('promo-edu', 'Student', 'body', '.edu', 'flat_cents', 500, 'both', 1, 0, 0)`
  ).run();
  return db;
}

// $36.99 * 20% = 739.8 -> Math.round -> 740 off -> $29.59.
const CDL_DISCOUNTED_CENTS = 3699 - 740;

function makeStripeFetchStub() {
  const createdIntents = [];
  const originalFetch = globalThis.fetch;
  let counter = 0;
  globalThis.fetch = async (url, opts) => {
    const href = String(url);
    if (href.startsWith('https://api.stripe.com/v1/payment_intents/')) {
      const id = href.split('/payment_intents/')[1].split('?')[0];
      const created = createdIntents.find((i) => i.id === id);
      return {
        ok: true,
        json: async () => ({
          id, status: 'succeeded', amount_received: created ? created.amount : 0,
          latest_charge: { billing_details: { email: 'new@example.com' } }, receipt_email: 'new@example.com',
        }),
      };
    }
    if (href === 'https://api.stripe.com/v1/payment_intents' && opts && opts.method === 'POST') {
      counter++;
      const amount = Number(new URLSearchParams(opts.body).get('amount'));
      const id = 'pi_test_' + counter;
      createdIntents.push({ id, amount });
      return { ok: true, json: async () => ({ id, client_secret: id + '_secret', amount }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { createdIntents, restore() { globalThis.fetch = originalFetch; } };
}

function postReq(path, body) {
  return new Request('https://api.example.com' + path, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

function setup(t) {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const stripe = makeStripeFetchStub();
  t.after(() => stripe.restore());
  return { db, env, stripe };
}

test('CDL-scoped first-purchase code discounts a full CDL checkout by 20% for a new email, and confirm accepts it', async (t) => {
  const { db, env, stripe } = setup(t);
  const createRes = await handleStripeCreateIntent(postReq('/stripe/create-intent', { examType: 'ca_cdl', turnstileToken: 'x', email: 'new@example.com', promoCode: 'newcdl20' }), env);
  assert.equal(createRes.status, 200);
  const body = await createRes.json();
  assert.equal(body.priceCents, CDL_DISCOUNTED_CENTS);
  assert.equal(body.promoDiscountCents, 740);
  assert.equal(stripe.createdIntents[0].amount, CDL_DISCOUNTED_CENTS);

  const paymentIntentId = body.clientSecret.split('_secret')[0];
  const confirmRes = await handleStripeConfirm(postReq('/stripe/confirm', { paymentIntentId, examType: 'ca_cdl', email: 'new@example.com' }), env);
  assert.equal(confirmRes.status, 200);
  assert.equal((await confirmRes.json()).capturedCents, CDL_DISCOUNTED_CENTS);
  assert.equal(db.prepare(`SELECT redeemed_count FROM promotions WHERE id = 'promo-cdl'`).get().redeemed_count, 1);
});

test('CDL-scoped code is rejected on a non-CDL track, no PaymentIntent created', async (t) => {
  const { env, stripe } = setup(t);
  const res = await handleStripeCreateIntent(postReq('/stripe/create-intent', { examType: 'ca_notary', turnstileToken: 'x', email: 'new@example.com', promoCode: CODE }), env);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'promo_wrong_track_kind');
  assert.equal(body.requiredTrackKind, CDL_KIND);
  assert.equal(stripe.createdIntents.length, 0);
});

test('CDL-scoped code is rejected for an email that already exists as a buyer', async (t) => {
  const { db, env, stripe } = setup(t);
  db.prepare(`INSERT INTO codes (code, exam_type, status, issued_at, paid_cents, buyer_email) VALUES ('OLD-1', 'ca_driver', 'redeemed', 0, 1999, 'Existing@Example.com')`).run();
  const res = await handleStripeCreateIntent(postReq('/stripe/create-intent', { examType: 'ca_cdl', turnstileToken: 'x', email: 'existing@example.com', promoCode: CODE }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'promo_not_first_purchase');
  assert.equal(stripe.createdIntents.length, 0);
});

test('CDL-scoped code requires an email (first-time check needs one)', async (t) => {
  const { env } = setup(t);
  const res = await handleStripeCreateIntent(postReq('/stripe/create-intent', { examType: 'ca_cdl', turnstileToken: 'x', promoCode: CODE }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'promo_first_purchase_only_email_required');
});

test('à la carte topic purchase is never discounted, even with the CDL code sent', async (t) => {
  const { db, env, stripe } = setup(t);
  const res = await handleStripeCreateIntent(postReq('/stripe/create-intent', {
    examType: 'ca_cdl', turnstileToken: 'x', email: 'new@example.com', promoCode: CODE,
    topics: ['General Knowledge (CDL Rules, Safe Driving & Cargo)'],
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.promoDiscountCents, 0);
  assert.equal(stripe.createdIntents[0].amount, body.priceCents);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pending_promo_discounts').get().n, 0);
});

test('/promotions lists a kind-scoped promo only when ?kind= matches', async (t) => {
  const { env } = setup(t);
  async function ids(query) {
    const res = await handlePromotionsList(new Request('https://api.example.com/promotions?' + query), env);
    return (await res.json()).promotions.map((p) => p.id);
  }
  assert.deepEqual(await ids('placement=home&kind=' + encodeURIComponent(CDL_KIND)), ['promo-cdl', 'promo-edu']);
  assert.deepEqual(await ids('placement=checkout&kind=' + encodeURIComponent(CDL_KIND)), ['promo-cdl', 'promo-edu']);
  assert.deepEqual(await ids('placement=home&kind=Notary'), ['promo-edu']);
  assert.deepEqual(await ids('placement=home'), ['promo-edu'], 'unscoped callers (hub, refer page) must never see a kind-scoped promo');
});
