// Regression coverage for admin-issued topic-scoped ("à la carte") access codes -- see project
// memory project_ca_cdl_topic_purchase_pilot. Before this, admin's "Generate code" facility
// (handleCodesGenerate) could only ever issue a full-track code; a comp/support code for CA CDL
// had no way to grant only some topics the way a real topic purchase does. `codes.topics_json`
// (new column) carries the intended scope from issuance through to redemption; handleRedeem copies
// it onto the new user's owned_topics_json, the same field every other à la carte restriction
// (quiz filtering, Exam/Weak Spots lock, refund-guarantee exclusion -- see
// ala-carte-restrictions.test.js) already reads.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleCodesGenerate, handleRedeem } from '../src/index.js';

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
    batch: async (statements) => statements.map((s) => s._runSync()),
  };
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE codes (code TEXT PRIMARY KEY, exam_type TEXT, status TEXT DEFAULT 'unused', note TEXT,
      expires_at INTEGER, redeemed_by TEXT, redeemed_at INTEGER, issued_at INTEGER, paid_cents INTEGER,
      buyer_email TEXT, referral_source TEXT, topics_json TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, exam_type TEXT, token TEXT, created_at INTEGER,
      last_seen_at INTEGER, owned_topics_json TEXT);
    CREATE TABLE track_key_breakdown (exam_type TEXT, label TEXT, declared_pct INTEGER, sort_order INTEGER);
  `);
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl', 'General Knowledge (CDL Rules, Safe Driving & Cargo)', 48, 0)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl', 'Air Brakes, Combination Vehicles & Doubles/Triples', 19, 1)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl', 'Vehicle Inspection Procedures', 6, 3)`).run();
  return db;
}

// makeD1's fake batch() needs each statement to expose a synchronous ._runSync() -- reproduce the
// same shape the real D1 adapter's .prepare().bind() chain already gives handleRedeem, since that's
// what env.DB.batch([...]) is called with there.
function makeD1WithSyncBatch(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (args) => ({
        first: async () => stmt.get(...args) ?? null,
        all: async () => ({ results: stmt.all(...args) }),
        run: async () => { stmt.run(...args); return {}; },
        _runSync: () => stmt.run(...args),
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    },
    batch: async (statements) => statements.map((s) => s._runSync()),
  };
}

function genReq(body) {
  return new Request('https://api.example.com/console/codes/generate', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

function redeemReq(code) {
  return new Request('https://api.example.com/redeem', {
    method: 'POST', body: JSON.stringify({ code }), headers: { 'content-type': 'application/json' },
  });
}

// ---- handleCodesGenerate ---------------------------------------------------

test('handleCodesGenerate: no topics field means a normal full-track code, unchanged from before this feature', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const res = await handleCodesGenerate(genReq({ examType: 'ca_cdl', note: 'comp' }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.topics, null);
  const row = db.prepare('SELECT topics_json FROM codes WHERE code = ?').get(body.code);
  assert.equal(row.topics_json, null);
});

test('handleCodesGenerate: real topic labels are stored as topics_json on the code', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const GK = 'General Knowledge (CDL Rules, Safe Driving & Cargo)';
  const res = await handleCodesGenerate(genReq({ examType: 'ca_cdl', topics: [GK] }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.topics, [GK]);
  const row = db.prepare('SELECT topics_json FROM codes WHERE code = ?').get(body.code);
  assert.deepEqual(JSON.parse(row.topics_json), [GK]);
});

test('handleCodesGenerate: an unknown/stale topic label is rejected outright, not silently dropped', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const res = await handleCodesGenerate(genReq({ examType: 'ca_cdl', topics: ['Not A Real Topic'] }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_topics');
  const count = db.prepare('SELECT COUNT(*) AS n FROM codes').get().n;
  assert.equal(count, 0, 'no code row should be created for a rejected request');
});

test('handleCodesGenerate: a mix of one real and one bogus label is rejected as a whole, not issued as the real subset', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const res = await handleCodesGenerate(genReq({ examType: 'ca_cdl', topics: ['Vehicle Inspection Procedures', 'Not Real'] }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_topics');
});

test('handleCodesGenerate: topics for a track with no track_key_breakdown rows is rejected (à la carte not offered there)', async () => {
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const res = await handleCodesGenerate(genReq({ examType: 'ca_driver', topics: ['Anything'] }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_topics');
});

// ---- handleRedeem -----------------------------------------------------------

test('handleRedeem: redeeming a topic-scoped admin code sets the new user\'s owned_topics_json', async () => {
  const rawDb = makeDb();
  const env = { DB: makeD1WithSyncBatch(rawDb) };
  const GK = 'General Knowledge (CDL Rules, Safe Driving & Cargo)';
  rawDb.prepare(`INSERT INTO codes (code, exam_type, status, issued_at, topics_json) VALUES ('TOPICCODE', 'ca_cdl', 'unused', ?, ?)`)
    .run(Math.floor(Date.now() / 1000), JSON.stringify([GK]));

  const res = await handleRedeem(redeemReq('TOPICCODE'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.isNewRedemption, true);
  const user = rawDb.prepare('SELECT owned_topics_json FROM users WHERE token = ?').get(body.token);
  assert.deepEqual(JSON.parse(user.owned_topics_json), [GK]);
});

test('handleRedeem: a normal (non-scoped) code still leaves owned_topics_json null -- full access, unaffected', async () => {
  const rawDb = makeDb();
  const env = { DB: makeD1WithSyncBatch(rawDb) };
  rawDb.prepare(`INSERT INTO codes (code, exam_type, status, issued_at) VALUES ('FULLCODE', 'ca_cdl', 'unused', ?)`)
    .run(Math.floor(Date.now() / 1000));

  const res = await handleRedeem(redeemReq('FULLCODE'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  const user = rawDb.prepare('SELECT owned_topics_json FROM users WHERE token = ?').get(body.token);
  assert.equal(user.owned_topics_json, null);
});
