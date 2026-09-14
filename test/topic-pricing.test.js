// Regression coverage for à la carte topic pricing (the CA CDL pilot's pricing engine --
// see project memory project_ca_cdl_topic_purchase_pilot). Formula: each topic's price =
// (full-track price × its declared_pct share) × (1 + admin-configurable padding %), rounded UP to
// the next .99, floored at an admin-configurable minimum.
//
// Three things matter enough to test explicitly:
// 1. Rounding is always UP, never down -- a downward round would quietly erase the padding's
//    protective margin (the whole reason padding exists: so summing every topic's price always
//    exceeds the full-track price, preventing a buyer from assembling the whole track cheaper by
//    buying every topic separately).
// 2. The minimum floor actually protects a small bucket (this pilot's real motivating case: CA
//    CDL's Vehicle Inspection topic, 6% of a $36.99 track, prices to ~$2-3 before the floor).
// 3. computeTopicPricing is server-authoritative and never trusts anything about a topic except
//    what's actually in track_key_breakdown -- an unknown/stale label is silently skipped, not
//    trusted at face value.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ceilTo99Cents, topicPriceCentsFor, computeTopicPricing, handleTopicPricingGet } from '../src/index.js';

function makeD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (args) => ({
        first: async () => stmt.get(...args) ?? null,
        all: async () => ({ results: stmt.all(...args) }),
        run: async () => { stmt.run(...args); return {}; },
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    },
  };
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE pricing (exam_type TEXT PRIMARY KEY, price_cents INTEGER, currency TEXT);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
    CREATE TABLE track_key_breakdown (
      id TEXT PRIMARY KEY, exam_type TEXT NOT NULL, label TEXT NOT NULL,
      declared_pct INTEGER NOT NULL, sort_order INTEGER NOT NULL
    );
  `);
  db.prepare(`INSERT INTO pricing VALUES ('ca_cdl', 3699, 'USD')`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-1', 'ca_cdl', 'General Knowledge (CDL Rules, Safe Driving & Cargo)', 48, 0)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-2', 'ca_cdl', 'Air Brakes, Combination Vehicles & Doubles/Triples', 19, 1)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-3', 'ca_cdl', 'Passenger, School Bus, Tank & HazMat Endorsements', 27, 2)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-4', 'ca_cdl', 'Vehicle Inspection Procedures', 6, 3)`).run();
  return db;
}

// ---- Pure math ----------------------------------------------------------

test('ceilTo99Cents: rounds up to the next .99, matching the user\'s own worked example ($17.31 -> $17.99, not $16.99)', () => {
  assert.equal(ceilTo99Cents(1731), 1799);
});
test('ceilTo99Cents: a value already ending in .99 is left unchanged', () => {
  assert.equal(ceilTo99Cents(1799), 1799);
});
test('ceilTo99Cents: a round-dollar value still rounds up, never down to the dollar below', () => {
  assert.equal(ceilTo99Cents(1800), 1899);
  assert.equal(ceilTo99Cents(100), 199);
});
test('ceilTo99Cents: a value just one cent over a .99 rolls to the next dollar\'s .99', () => {
  assert.equal(ceilTo99Cents(1800), 1899, '$18.00 must not round down to $17.99, which would be BELOW the input');
});

test('topicPriceCentsFor: applies share and padding before rounding up', () => {
  // $36.99 * 19% = $7.03 (703 cents), * 1.20 padding = 843.6 -> round 844 -> ceil to 899
  assert.equal(topicPriceCentsFor(3699, 19, 20, 0), 899);
});
test('topicPriceCentsFor: the minimum floor overrides a small bucket\'s computed price -- the pilot\'s real motivating case (CA CDL Vehicle Inspection)', () => {
  // $36.99 * 6% = $2.22, * 1.20 padding = $2.66 -> ceil to $2.99 -- still well under a $9.99 floor
  const withoutFloor = topicPriceCentsFor(3699, 6, 20, 0);
  assert.ok(withoutFloor < 999, 'sanity check: the unfloored price really is under the floor, or this test proves nothing');
  assert.equal(topicPriceCentsFor(3699, 6, 20, 999), 999);
});
test('topicPriceCentsFor: the floor never LOWERS a topic that already prices above it', () => {
  const price = topicPriceCentsFor(3699, 48, 20, 999); // GK, the largest bucket
  assert.ok(price > 999);
});
test('topicPriceCentsFor: summing every topic\'s padded price always exceeds the unpadded full-track price (the whole point of padding)', () => {
  const topics = [[48], [19], [27], [6]]; // CA CDL's real declared_pct values, sum to 100
  const total = topics.reduce((sum, [pct]) => sum + topicPriceCentsFor(3699, pct, 20, 0), 0);
  assert.ok(total > 3699, `padded sum (${total}) must exceed the full price (3699) so buying every topic never undercuts the bundle`);
});
test('topicPriceCentsFor: zero padding still sums to approximately the full price (rounding-up drift only, never under)', () => {
  const topics = [48, 19, 27, 6];
  const total = topics.reduce((sum, pct) => sum + topicPriceCentsFor(3699, pct, 0, 0), 0);
  assert.ok(total >= 3699, 'even with zero padding, rounding every share UP can only push the sum at or above the full price, never below it');
});

// ---- computeTopicPricing (DB-integration) --------------------------------

test('computeTopicPricing: uses the real full price, real declared_pct, and admin settings from the DB', async () => {
  const db = makeDb();
  db.prepare(`INSERT INTO app_settings VALUES ('topic_price_padding_pct', '20', 0)`).run();
  db.prepare(`INSERT INTO app_settings VALUES ('topic_price_min_cents', '999', 0)`).run();
  const env = { DB: makeD1(db) };

  // Endorsements (27%) is used here, not a smaller bucket -- its unfloored price ($11.99, see
  // math below) comfortably clears this test's own topic_price_min_cents (999), so this proves the
  // real padding % actually reaches the calculation rather than being masked by the floor (the
  // floor-specifically case is covered separately below).
  const result = await computeTopicPricing(env, 'ca_cdl', ['Passenger, School Bus, Tank & HazMat Endorsements']);
  assert.equal(result.fullPriceCents, 3699);
  assert.equal(result.items.length, 1);
  // $36.99 * 27% = $9.99 (998.73), * 1.20 padding = $11.98 (1198.48) -> round 1198 -> ceil to 1199
  assert.equal(result.items[0].priceCents, 1199);
  assert.equal(result.totalCents, 1199);
});

test('computeTopicPricing: falls back to default padding/floor when no app_settings rows exist yet', async () => {
  const db = makeDb(); // no app_settings rows inserted at all
  const env = { DB: makeD1(db) };
  const result = await computeTopicPricing(env, 'ca_cdl', ['Vehicle Inspection Procedures']);
  assert.equal(result.items[0].priceCents, 999, 'default padding (20%) still prices VI under the default floor (999), so the default floor must apply');
});

test('computeTopicPricing: multiple topics sum correctly and each carries its own label', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const result = await computeTopicPricing(env, 'ca_cdl', [
    'General Knowledge (CDL Rules, Safe Driving & Cargo)',
    'Vehicle Inspection Procedures',
  ]);
  assert.equal(result.items.length, 2);
  assert.equal(result.totalCents, result.items[0].priceCents + result.items[1].priceCents);
});

test('computeTopicPricing: an unknown/stale topic label is silently skipped, not trusted or errored', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const result = await computeTopicPricing(env, 'ca_cdl', ['Not A Real Topic', 'Vehicle Inspection Procedures']);
  assert.equal(result.items.length, 1, 'the fake label must not produce a priced item');
  assert.equal(result.items[0].label, 'Vehicle Inspection Procedures');
});

test('computeTopicPricing: a track with no track_key_breakdown rows at all prices nothing (not an error, not a guess)', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const result = await computeTopicPricing(env, 'tx_cdl', ['General Knowledge']);
  assert.deepEqual(result.items, []);
  assert.equal(result.totalCents, 0);
});

// ---- handleTopicPricingGet (endpoint) ------------------------------------

function req(query) {
  return new Request('https://api.example.com/topic-pricing' + query);
}

test('handleTopicPricingGet: comma-separated topics query param resolves to a real total', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const res = await handleTopicPricingGet(req('?examType=ca_cdl&topics=' + encodeURIComponent('Vehicle Inspection Procedures')), env);
  const body = await res.json();
  assert.equal(body.examType, 'ca_cdl');
  assert.equal(body.totalCents, 999);
});

test('handleTopicPricingGet: missing examType or topics is rejected with 400', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  assert.equal((await handleTopicPricingGet(req('?topics=General+Knowledge'), env)).status, 400);
  assert.equal((await handleTopicPricingGet(req('?examType=ca_cdl'), env)).status, 400);
});
