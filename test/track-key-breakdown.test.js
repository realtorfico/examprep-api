// Regression coverage for handleTrackKeyBreakdownGet (GET /track-key-breakdown) -- the public,
// read-only endpoint backing the à la carte topic-purchase pilot's canonical "Key Breakdown" table
// (see track_key_breakdown's own schema.sql comment for the full rationale: this table exists to
// stop the site's hardcoded breakdown array and questions.topic from being two independently
// drifting sources of the same thing). Verifies the two things that matter: rows come back ordered
// by sort_order (not insertion order or alphabetical), and a track with no rows yet (not migrated)
// returns an empty array rather than an error -- callers need to treat that as "not available for
// topic purchase yet", not a failure.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleTrackKeyBreakdownGet } from '../src/index.js';

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
    CREATE TABLE track_key_breakdown (
      id TEXT PRIMARY KEY, exam_type TEXT NOT NULL, label TEXT NOT NULL,
      declared_pct INTEGER NOT NULL, sort_order INTEGER NOT NULL
    );
  `);
  // Inserted out of sort_order on purpose, to prove the query orders by sort_order and not
  // insertion order.
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-3', 'ca_cdl', 'Passenger, School Bus, Tank & HazMat Endorsements', 27, 2)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-1', 'ca_cdl', 'General Knowledge (CDL Rules, Safe Driving & Cargo)', 48, 0)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-4', 'ca_cdl', 'Vehicle Inspection Procedures', 6, 3)`).run();
  db.prepare(`INSERT INTO track_key_breakdown VALUES ('ca_cdl-kb-2', 'ca_cdl', 'Air Brakes, Combination Vehicles & Doubles/Triples', 19, 1)`).run();
  return db;
}

function req(query) {
  return new Request('https://api.example.com/track-key-breakdown' + query);
}

test('returns a migrated track\'s rows ordered by sort_order, not insertion order', async (t) => {
  const env = { DB: makeD1(makeDb()) };
  const res = await handleTrackKeyBreakdownGet(req('?examType=ca_cdl'), env);
  const body = await res.json();
  assert.deepEqual(body.items.map((r) => r.label), [
    'General Knowledge (CDL Rules, Safe Driving & Cargo)',
    'Air Brakes, Combination Vehicles & Doubles/Triples',
    'Passenger, School Bus, Tank & HazMat Endorsements',
    'Vehicle Inspection Procedures',
  ]);
  assert.deepEqual(body.items.map((r) => r.declared_pct), [48, 19, 27, 6]);
});

test('a track with no rows yet returns an empty array, not an error', async (t) => {
  const env = { DB: makeD1(makeDb()) };
  const res = await handleTrackKeyBreakdownGet(req('?examType=tx_cdl'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.items, []);
});

test('missing examType is rejected with a 400, not an unscoped query', async (t) => {
  const env = { DB: makeD1(makeDb()) };
  const res = await handleTrackKeyBreakdownGet(req(''), env);
  assert.equal(res.status, 400);
});
