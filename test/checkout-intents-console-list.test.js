// Regression coverage for handleConsoleCheckoutIntentsList -- the read-only admin endpoint backing
// the "Buy-page leads" tab (passexamhq-admin), added so the buy-page exit-intent modal's own copy
// ("we may also let you know about promos and sale events" -- see maybeShowExitIntentModal in the
// site's app.js) is actually true rather than a promise nothing can act on. Verifies the three
// things that matter for correctness: purchased leads never show up (they're not leads anymore),
// the source filter (exit_capture / checkout_form / all) actually filters, and the days cutoff
// actually excludes old rows.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleConsoleCheckoutIntentsList } from '../src/index.js';

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

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE checkout_intents (
      id TEXT PRIMARY KEY, email TEXT, exam_type TEXT, created_at INTEGER,
      purchased_at INTEGER, reminder_sent_at INTEGER, source TEXT
    );
  `);
  // Recent exit-capture lead, never purchased -- should show up by default.
  db.prepare(`INSERT INTO checkout_intents VALUES ('i1', 'exit@example.com', 'ca_notary', ?, NULL, NULL, 'exit_capture')`)
    .run(NOW - 1 * DAY);
  // Recent checkout-form lead, never purchased -- should be excluded by the default source filter.
  db.prepare(`INSERT INTO checkout_intents VALUES ('i2', 'form@example.com', 'ca_notary', ?, NULL, NULL, 'checkout_form')`)
    .run(NOW - 1 * DAY);
  // Recent exit-capture lead that DID go on to purchase -- must never appear (not a lead anymore).
  db.prepare(`INSERT INTO checkout_intents VALUES ('i3', 'bought@example.com', 'ca_notary', ?, ?, NULL, 'exit_capture')`)
    .run(NOW - 1 * DAY, NOW - 1 * DAY + 100);
  // Old exit-capture lead, outside the default 90-day window.
  db.prepare(`INSERT INTO checkout_intents VALUES ('i4', 'old@example.com', 'ca_notary', ?, NULL, NULL, 'exit_capture')`)
    .run(NOW - 200 * DAY);
  // Pre-migration row with a NULL source -- schema.sql says this is treated as 'checkout_form'.
  db.prepare(`INSERT INTO checkout_intents VALUES ('i5', 'legacy@example.com', 'ca_notary', ?, NULL, NULL, NULL)`)
    .run(NOW - 1 * DAY);
  return db;
}

function req(query) {
  return new Request('https://api.example.com/console/checkout-intents' + query);
}

test('defaults to unpurchased exit_capture leads from the last 90 days', async (t) => {
  const env = { DB: makeD1(makeDb()) };
  const res = await handleConsoleCheckoutIntentsList(req(''), env);
  const body = await res.json();
  const emails = body.items.map((r) => r.email).sort();
  assert.deepEqual(emails, ['exit@example.com']);
  assert.equal(body.source, 'exit_capture');
});

test('source=checkout_form picks up the NULL-source legacy row too, via the COALESCE fallback', async (t) => {
  const env = { DB: makeD1(makeDb()) };
  const res = await handleConsoleCheckoutIntentsList(req('?source=checkout_form'), env);
  const body = await res.json();
  const emails = body.items.map((r) => r.email).sort();
  assert.deepEqual(emails, ['form@example.com', 'legacy@example.com']);
});

test('source=all returns every unpurchased row regardless of source, still respecting the days window', async (t) => {
  const env = { DB: makeD1(makeDb()) };
  const res = await handleConsoleCheckoutIntentsList(req('?source=all'), env);
  const body = await res.json();
  const emails = body.items.map((r) => r.email).sort();
  assert.deepEqual(emails, ['exit@example.com', 'form@example.com', 'legacy@example.com']);
});

test('a lead who went on to purchase is excluded even with source=all', async (t) => {
  const env = { DB: makeD1(makeDb()) };
  const res = await handleConsoleCheckoutIntentsList(req('?source=all'), env);
  const body = await res.json();
  assert.ok(!body.items.some((r) => r.email === 'bought@example.com'));
});

test('days= widens the window to reach an older row', async (t) => {
  const env = { DB: makeD1(makeDb()) };
  const res = await handleConsoleCheckoutIntentsList(req('?days=300'), env);
  const body = await res.json();
  const emails = body.items.map((r) => r.email).sort();
  assert.deepEqual(emails, ['exit@example.com', 'old@example.com']);
});
