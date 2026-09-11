// Regression coverage for the 2026-09-11 incident: a Cloudflare Web Analytics 5xx spike (511%
// jump over 7 days, spread across many unrelated simple endpoints) traced to three public
// sitewide-stats handlers (handlePublicStats -- fires on every homepage load -- plus
// handlePassRatesByCategory/handleQuizAccuracyByCategory) each running an uncached full scan of
// the `progress`/`exam_attempts` tables on every single request. See
// [[project_5xx_spike_diagnosis_20260911]] for the full diagnosis. Fixed with the same in-memory
// 5-min TTL cache pattern already used for trackRegistryCache.
//
// This test exists so that pattern can never silently regress again: it proves a SECOND call
// within the TTL window does not touch the database at all (not just "returns the same numbers",
// which a bug could coincidentally satisfy) by counting real prepare() calls against a fake D1
// backed by node:sqlite, and proves the cache is genuinely time-scoped (not just "always returns
// stale data forever") by resetting it and confirming fresh data comes through afterward.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handlePublicStats, handlePassRatesByCategory, handleQuizAccuracyByCategory, _resetStatsCacheForTests } from '../src/index.js';

// Minimal D1-shaped adapter over node:sqlite -- mirrors the chainable prepare().bind().first()/
// .all() API these handlers actually call, and counts real prepare() invocations so tests can
// assert "the database was NOT touched a second time", not just "the response looked right".
function makeD1(db) {
  let prepareCount = 0;
  return {
    get prepareCount() { return prepareCount; },
    prepare(sql) {
      prepareCount++;
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
    CREATE TABLE users (id TEXT PRIMARY KEY, exam_type TEXT);
    CREATE TABLE codes (code TEXT PRIMARY KEY, status TEXT, redeemed_by TEXT);
    CREATE TABLE questions (id TEXT PRIMARY KEY, exam_type TEXT, topic TEXT);
    CREATE TABLE progress (
      user_id TEXT, question_id TEXT, times_seen INTEGER, times_correct INTEGER,
      last_result TEXT, PRIMARY KEY (user_id, question_id)
    );
    CREATE TABLE exam_attempts (
      id TEXT PRIMARY KEY, exam_type TEXT, score_correct INTEGER, score_total INTEGER,
      pass_percent INTEGER, submitted_at INTEGER
    );
    CREATE TABLE track_registry (exam_type TEXT PRIMARY KEY, kind TEXT, active INTEGER);
  `);

  db.prepare("INSERT INTO track_registry VALUES ('ca_notary', 'Notary', 1)").run();
  db.prepare("INSERT INTO track_registry VALUES ('ca_driver', 'Driver', 1)").run();

  db.prepare("INSERT INTO users VALUES ('u1', 'ca_notary')").run();
  db.prepare("INSERT INTO codes VALUES ('CODE1', 'redeemed', 'u1')").run();
  db.prepare("INSERT INTO questions VALUES ('q1', 'ca_notary', 'Fees')").run();
  db.prepare("INSERT INTO questions VALUES ('q2', 'ca_notary', 'Fees')").run();
  db.prepare("INSERT INTO progress VALUES ('u1', 'q1', 3, 2, 'correct')").run();
  db.prepare("INSERT INTO progress VALUES ('u1', 'q2', 1, 1, 'correct')").run();
  db.prepare("INSERT INTO exam_attempts VALUES ('a1', 'ca_notary', 40, 45, 70, 1000)").run();

  return db;
}

test('handlePublicStats: a second call within the TTL serves cached data and never re-queries the database', async () => {
  _resetStatsCacheForTests();
  const env = { DB: makeD1(makeDb()) };

  const first = await (await handlePublicStats(env)).json();
  const countAfterFirst = env.DB.prepareCount;
  assert.ok(countAfterFirst > 0, 'the first call must actually hit the database');
  assert.equal(first.studentsServed, 1);
  assert.equal(first.totalQuestions, 2);

  // Mutate the underlying DB -- if the second call were still hitting the database (even by
  // accident, e.g. a caching condition that never actually matches), this would be reflected in
  // its response, which the next assertion would catch.
  env.DB.prepare("INSERT INTO codes VALUES ('CODE2', 'redeemed', 'u2')").run();
  const countBeforeSecondCall = env.DB.prepareCount;

  const second = await (await handlePublicStats(env)).json();
  assert.equal(env.DB.prepareCount, countBeforeSecondCall, 'a cached second call must not issue any new prepare() calls at all');
  assert.deepEqual(second, first, 'a cached second call must return the exact same payload as the first, not the post-mutation state');

  _resetStatsCacheForTests();
  const third = await (await handlePublicStats(env)).json();
  assert.ok(env.DB.prepareCount > countAfterFirst, 'after an explicit cache reset, the next call must hit the database again');
  assert.equal(third.studentsServed, 2, 'once fresh, the response must reflect the mutation made while the cache was warm');
});

test('handlePassRatesByCategory: same cache-then-reset contract as handlePublicStats', async () => {
  _resetStatsCacheForTests();
  const env = { DB: makeD1(makeDb()) };

  const first = await (await handlePassRatesByCategory(env)).json();
  const countAfterFirst = env.DB.prepareCount;
  assert.ok(countAfterFirst > 0);
  const notaryFirst = first.categories.find((c) => c.kind === 'Notary');
  assert.equal(notaryFirst.attemptCount, 1);

  env.DB.prepare("INSERT INTO exam_attempts VALUES ('a2', 'ca_notary', 45, 45, 70, 2000)").run();
  const countBeforeSecondCall = env.DB.prepareCount;

  const second = await (await handlePassRatesByCategory(env)).json();
  assert.equal(env.DB.prepareCount, countBeforeSecondCall, 'a cached second call must not issue any new prepare() calls at all');
  assert.deepEqual(second, first);

  _resetStatsCacheForTests();
  const third = await (await handlePassRatesByCategory(env)).json();
  const notaryThird = third.categories.find((c) => c.kind === 'Notary');
  assert.equal(notaryThird.attemptCount, 2, 'once fresh, the response must reflect the newly-inserted attempt');
});

test('handleQuizAccuracyByCategory: same cache-then-reset contract as handlePublicStats', async () => {
  _resetStatsCacheForTests();
  const env = { DB: makeD1(makeDb()) };

  const first = await (await handleQuizAccuracyByCategory(env)).json();
  const countAfterFirst = env.DB.prepareCount;
  assert.ok(countAfterFirst > 0);
  const notaryFirst = first.categories.find((c) => c.kind === 'Notary');
  assert.equal(notaryFirst.questionsAnswered, 4, 'u1 attempted q1(3) + q2(1) = 4 times');

  env.DB.prepare("INSERT INTO users VALUES ('u2', 'ca_notary')").run();
  env.DB.prepare("INSERT INTO progress VALUES ('u2', 'q1', 5, 5, 'correct')").run();
  const countBeforeSecondCall = env.DB.prepareCount;

  const second = await (await handleQuizAccuracyByCategory(env)).json();
  assert.equal(env.DB.prepareCount, countBeforeSecondCall, 'a cached second call must not issue any new prepare() calls at all');
  assert.deepEqual(second, first);

  _resetStatsCacheForTests();
  const third = await (await handleQuizAccuracyByCategory(env)).json();
  const notaryThird = third.categories.find((c) => c.kind === 'Notary');
  assert.equal(notaryThird.questionsAnswered, 9, 'once fresh, the response must include u2\'s newly-inserted 5 attempts (4 + 5)');
});
