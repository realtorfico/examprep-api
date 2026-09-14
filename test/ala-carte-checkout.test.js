// Regression coverage for the à la carte topic-purchase checkout flow (CA CDL pilot) -- the
// highest-stakes surface in this whole project: real Stripe PaymentIntent creation/confirmation,
// real money. See project memory project_ca_cdl_topic_purchase_pilot.
//
// Three things matter enough to test explicitly, beyond "does the happy path work":
// 1. handleStripeCreateIntent's topics branch never touches the existing full-price flow at all
//    (promo codes, referral points) when `topics` is absent -- verified by confirming the
//    full-price path is byte-for-byte unaffected.
// 2. handleStripeConfirm re-derives the expected charge amount server-side via
//    computeTopicPricing (never trusts a client-reported amount) and rejects a payment whose
//    actual captured amount doesn't match it -- the real security boundary.
// 3. A crafted isGift:true request against a real topic purchase is forced onto the correct,
//    topic-scoped non-gift path rather than either silently granting an unscoped gift code (a
//    real exploit: pay the cheaper topic price, receive full unscoped access) or being trusted at
//    face value.
//
// Stripe's real API is mocked via a global fetch stub keyed on hostname (api.stripe.com) -- these
// tests never make a real network call or touch a real Stripe account.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleStripeCreateIntent, handleStripeConfirm, _resetTrackRegistryCacheForTests } from '../src/index.js';

function makeD1(db) {
  function prepare(sql) {
    const stmt = db.prepare(sql);
    const bound = (args) => ({
      first: async () => stmt.get(...args) ?? null,
      all: async () => ({ results: stmt.all(...args) }),
      run: async () => { const r = stmt.run(...args); return { meta: { changes: r.changes } }; },
      // .batch() below needs a synchronous statement object to run against -- node:sqlite's own
      // .run() is already synchronous, so this just skips the artificial async wrapper.
      _runSync: () => stmt.run(...args),
    });
    return { ...bound([]), bind: (...args) => bound(args) };
  }
  return {
    prepare,
    // Real D1's .batch() runs a list of already-.bind()'d statements atomically -- this fake just
    // runs them in order, which is all issueAndRedeemCode's own multi-insert needs for a test.
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
      points_multiplier INTEGER, points_multiplier_days INTEGER, placement TEXT DEFAULT 'both',
      active INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, redeemed_count INTEGER DEFAULT 0,
      starts_at INTEGER, ends_at INTEGER, created_at INTEGER
    );
    CREATE TABLE point_rules (task_key TEXT PRIMARY KEY, points INTEGER, active INTEGER);
  `);
  db.prepare(`INSERT INTO track_registry VALUES ('ca_cdl', 'CDL', 'CA', 'CA CDL', 1, 1, 50, 3600, 80, 40, NULL, 0)`).run();
  db.prepare(`INSERT INTO pricing VALUES ('ca_cdl', 3699, 'USD')`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-1', 'ca_cdl', 'General Knowledge (CDL Rules, Safe Driving & Cargo)', 48, 0)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-2', 'ca_cdl', 'Air Brakes, Combination Vehicles & Doubles/Triples', 19, 1)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-3', 'ca_cdl', 'Passenger, School Bus, Tank & HazMat Endorsements', 27, 2)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-4', 'ca_cdl', 'Vehicle Inspection Procedures', 6, 3)`).run();
  return db;
}

const GK_TOPIC = 'General Knowledge (CDL Rules, Safe Driving & Cargo)';
// Same math as test/topic-pricing.test.js: $36.99 * 48% = $17.76, * 1.20 default padding = $21.31 -> ceil to $21.99.
const GK_PRICE_CENTS = 2199;

// ---- Fake Stripe -----------------------------------------------------------

function makeStripeFetchStub({ succeededAmount } = {}) {
  const createdIntents = [];
  const originalFetch = globalThis.fetch;
  let counter = 0;
  globalThis.fetch = async (url, opts) => {
    const href = String(url);
    if (href.startsWith('https://api.stripe.com/v1/payment_intents/')) {
      // Retrieve.
      const id = href.split('/payment_intents/')[1].split('?')[0];
      const created = createdIntents.find((i) => i.id === id);
      return {
        ok: true,
        json: async () => ({
          id,
          status: 'succeeded',
          amount_received: succeededAmount != null ? succeededAmount : (created ? created.amount : 0),
          latest_charge: { billing_details: { email: 'buyer@example.com' } },
          receipt_email: 'buyer@example.com',
        }),
      };
    }
    if (href === 'https://api.stripe.com/v1/payment_intents' && opts && opts.method === 'POST') {
      // Create.
      counter++;
      const params = new URLSearchParams(opts.body);
      const amount = Number(params.get('amount'));
      const id = 'pi_test_' + counter;
      createdIntents.push({ id, amount });
      return { ok: true, json: async () => ({ id, client_secret: id + '_secret', amount }) };
    }
    // Anything else (e.g. a best-effort email send) -- fail fast, harmless since every real
    // caller of those wraps its own call in try/catch.
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return {
    createdIntents,
    restore() { globalThis.fetch = originalFetch; },
  };
}

function createReq(body) {
  return new Request('https://api.example.com/stripe/create-intent', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}
function confirmReq(body) {
  return new Request('https://api.example.com/stripe/confirm', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

// ---- handleStripeCreateIntent -----------------------------------------------

test('handleStripeCreateIntent: à la carte topics creates a PaymentIntent for the correct topic-computed amount', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const stripe = makeStripeFetchStub();
  t.after(() => stripe.restore());

  const res = await handleStripeCreateIntent(createReq({ examType: 'ca_cdl', turnstileToken: 'x', email: 'buyer@example.com', topics: [GK_TOPIC] }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.priceCents, GK_PRICE_CENTS);
  assert.equal(stripe.createdIntents.length, 1);
  assert.equal(stripe.createdIntents[0].amount, GK_PRICE_CENTS);

  const pending = db.prepare('SELECT * FROM pending_topic_purchases WHERE order_id = ?').get(stripe.createdIntents[0].id);
  assert.ok(pending, 'a pending_topic_purchases row must be written for the actual PaymentIntent id');
  assert.deepEqual(JSON.parse(pending.topics_json), [GK_TOPIC]);
});

test('handleStripeCreateIntent: an unknown/tampered topic label is rejected, no PaymentIntent created', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const stripe = makeStripeFetchStub();
  t.after(() => stripe.restore());

  const res = await handleStripeCreateIntent(createReq({ examType: 'ca_cdl', turnstileToken: 'x', email: 'buyer@example.com', topics: [GK_TOPIC, 'Not A Real Topic'] }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_topics');
  assert.equal(stripe.createdIntents.length, 0, 'must never create a real charge for a tampered topic list');
});

test('handleStripeCreateIntent: the full-price flow (no topics) is completely unaffected', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const stripe = makeStripeFetchStub();
  t.after(() => stripe.restore());

  const res = await handleStripeCreateIntent(createReq({ examType: 'ca_cdl', turnstileToken: 'x', email: 'buyer@example.com' }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.priceCents, 3699, 'must charge the real full track price, unaffected by the new topics branch');
  const pendingCount = db.prepare('SELECT COUNT(*) AS n FROM pending_topic_purchases').get().n;
  assert.equal(pendingCount, 0, 'a full-price checkout must never write a pending_topic_purchases row');
});

// ---- handleStripeConfirm -----------------------------------------------------

test('handleStripeConfirm: a real à la carte purchase issues a code and sets owned_topics_json correctly', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const stripe = makeStripeFetchStub();
  t.after(() => stripe.restore());

  const createRes = await handleStripeCreateIntent(createReq({ examType: 'ca_cdl', turnstileToken: 'x', email: 'buyer@example.com', topics: [GK_TOPIC] }), env);
  const { clientSecret } = await createRes.json();
  const paymentIntentId = clientSecret.split('_secret')[0];

  const confirmRes = await handleStripeConfirm(confirmReq({ paymentIntentId, examType: 'ca_cdl', email: 'buyer@example.com' }), env);
  assert.equal(confirmRes.status, 200);
  const confirmBody = await confirmRes.json();
  assert.ok(confirmBody.code);
  assert.equal(confirmBody.capturedCents, GK_PRICE_CENTS);

  const user = db.prepare('SELECT * FROM users WHERE token = ?').get(confirmBody.token);
  assert.ok(user, 'a real users row must exist for a non-gift purchase');
  assert.deepEqual(JSON.parse(user.owned_topics_json), [GK_TOPIC]);

  const pendingCount = db.prepare('SELECT COUNT(*) AS n FROM pending_topic_purchases WHERE order_id = ?').get(paymentIntentId).n;
  assert.equal(pendingCount, 0, 'the pending row must be cleaned up after a successful confirm');
});

test('handleStripeConfirm: rejects when the actually-captured Stripe amount does not match the recomputed topic price', async (t) => {
  // Simulates a tampered/stale client request -- the PaymentIntent was genuinely created (and
  // "paid") for GK_PRICE_CENTS, but Stripe reports a DIFFERENT captured amount than what
  // computeTopicPricing independently recomputes server-side right now.
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const stripe = makeStripeFetchStub({ succeededAmount: GK_PRICE_CENTS - 500 }); // captured $5 less than expected
  t.after(() => stripe.restore());

  const createRes = await handleStripeCreateIntent(createReq({ examType: 'ca_cdl', turnstileToken: 'x', email: 'buyer@example.com', topics: [GK_TOPIC] }), env);
  const { clientSecret } = await createRes.json();
  const paymentIntentId = clientSecret.split('_secret')[0];

  const confirmRes = await handleStripeConfirm(confirmReq({ paymentIntentId, examType: 'ca_cdl', email: 'buyer@example.com' }), env);
  assert.equal(confirmRes.status, 402);
  assert.equal((await confirmRes.json()).error, 'amount_mismatch');
  const codeCount = db.prepare('SELECT COUNT(*) AS n FROM codes').get().n;
  assert.equal(codeCount, 0, 'no code must ever be issued when the captured amount does not match');
});

test('handleStripeConfirm: isGift:true against a real topic purchase is forced onto the topic-scoped path, never an unscoped gift code', async (t) => {
  // The real exploit this guards against: pay the (cheaper) topic-only price, then claim isGift
  // to receive a full, unscoped gift code instead of a topic-restricted account.
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const stripe = makeStripeFetchStub();
  t.after(() => stripe.restore());

  const createRes = await handleStripeCreateIntent(createReq({ examType: 'ca_cdl', turnstileToken: 'x', email: 'buyer@example.com', topics: [GK_TOPIC] }), env);
  const { clientSecret } = await createRes.json();
  const paymentIntentId = clientSecret.split('_secret')[0];

  const confirmRes = await handleStripeConfirm(confirmReq({
    paymentIntentId, examType: 'ca_cdl', email: 'buyer@example.com',
    isGift: true, recipientEmail: 'friend@example.com',
  }), env);
  assert.equal(confirmRes.status, 200);
  const confirmBody = await confirmRes.json();
  assert.equal(confirmBody.isGift, false, 'must never report this as a successful gift purchase');
  assert.ok(confirmBody.token, 'a real login token must be minted -- the gift path never mints one');

  const codeRow = db.prepare('SELECT * FROM codes WHERE code = ?').get(confirmBody.code);
  assert.equal(codeRow.status, 'redeemed', 'the code must be immediately redeemed under the buyer\'s own account, not left unused for a gift recipient');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(codeRow.redeemed_by);
  assert.deepEqual(JSON.parse(user.owned_topics_json), [GK_TOPIC], 'the resulting account must still be correctly topic-scoped');
});

test('handleStripeConfirm: a retried confirm call for the same PaymentIntent is idempotent, does not double-issue', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const stripe = makeStripeFetchStub();
  t.after(() => stripe.restore());

  const createRes = await handleStripeCreateIntent(createReq({ examType: 'ca_cdl', turnstileToken: 'x', email: 'buyer@example.com', topics: [GK_TOPIC] }), env);
  const { clientSecret } = await createRes.json();
  const paymentIntentId = clientSecret.split('_secret')[0];

  const first = await handleStripeConfirm(confirmReq({ paymentIntentId, examType: 'ca_cdl', email: 'buyer@example.com' }), env);
  const firstBody = await first.json();
  const second = await handleStripeConfirm(confirmReq({ paymentIntentId, examType: 'ca_cdl', email: 'buyer@example.com' }), env);
  const secondBody = await second.json();

  assert.equal(secondBody.code, firstBody.code, 'a retry must return the same code, not issue a second one');
  const codeCount = db.prepare('SELECT COUNT(*) AS n FROM codes').get().n;
  assert.equal(codeCount, 1);
});

test('handleStripeConfirm: the full-price flow (no pending topic purchase) computes its expected amount exactly as before', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const stripe = makeStripeFetchStub();
  t.after(() => stripe.restore());

  const createRes = await handleStripeCreateIntent(createReq({ examType: 'ca_cdl', turnstileToken: 'x', email: 'buyer@example.com' }), env);
  const { clientSecret } = await createRes.json();
  const paymentIntentId = clientSecret.split('_secret')[0];

  const confirmRes = await handleStripeConfirm(confirmReq({ paymentIntentId, examType: 'ca_cdl', email: 'buyer@example.com' }), env);
  assert.equal(confirmRes.status, 200);
  const body = await confirmRes.json();
  assert.equal(body.capturedCents, 3699);
  const user = db.prepare('SELECT * FROM users WHERE token = ?').get(body.token);
  assert.equal(user.owned_topics_json, null, 'a normal full-track purchase must never set owned_topics_json');
});
