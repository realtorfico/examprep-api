// Regression coverage for the 2026-09-11 findNextQuestionRow rewrite: replaced a full, unindexed
// `progress` GROUP BY recomputed on every single "next question" request (the highest-QPS
// authenticated endpoint in the app) with a 5-min-TTL cached difficulty index, joined via
// json_each() instead of a per-id bound parameter (D1/SQLite has a limited bound-parameter count).
// See [[project_5xx_spike_diagnosis_20260911]]-adjacent code review for the full diagnosis.
//
// This is the highest-risk change made this session -- it touches live exam-serving logic for
// real students -- so this file deliberately over-tests: exact band-threshold math, cross-track
// isolation, cache hit/miss/reset behavior (same contract as public-stats-caching.test.js), AND
// the trickiest part of the rewrite -- bind-parameter ORDER staying correct when the new
// json_each(?) join combines with the pre-existing exclude-last-answered-question filter, which
// only a scenario with a real SQL round-trip can actually prove (a bind-order mistake would
// either throw or silently return the wrong row, both of which this test would catch).
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getDifficultyIndex, findNextQuestionRow, _resetDifficultyIndexCacheForTests } from '../src/index.js';

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
    CREATE TABLE questions (id TEXT PRIMARY KEY, exam_type TEXT, topic TEXT, weight INTEGER DEFAULT 1,
      question TEXT, choice_a TEXT, choice_b TEXT, choice_c TEXT, choice_d TEXT, correct_choice TEXT, explanation TEXT);
    CREATE TABLE progress (
      user_id TEXT, question_id TEXT, times_seen INTEGER, times_correct INTEGER,
      last_result TEXT, last_choice TEXT, last_answered_at INTEGER, PRIMARY KEY (user_id, question_id)
    );
  `);
  return db;
}

function insertQuestion(db, id, examType, weight) {
  db.prepare('INSERT INTO questions (id, exam_type, topic, weight, question, choice_a, choice_b, choice_c, choice_d, correct_choice) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, examType, 'General', weight || 1, 'Q?', 'A', 'B', 'C', 'D', 'A');
}
function insertProgress(db, userId, questionId, seen, correct, lastResult, lastAnsweredAt) {
  db.prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)')
    .run(userId, questionId, seen, correct, lastResult || null, null, lastAnsweredAt || null);
}

test('getDifficultyIndex: band thresholds match the original DIFFICULTY_CASE exactly', async () => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'easy1', 'ca_notary');    insertProgress(db, 'u1', 'easy1', 10, 9, 'correct', 1);   // 90% -> easy
  insertQuestion(db, 'mod1', 'ca_notary');     insertProgress(db, 'u1', 'mod1', 10, 7, 'correct', 1);    // 70% -> moderate
  insertQuestion(db, 'hard1', 'ca_notary');    insertProgress(db, 'u1', 'hard1', 10, 5, 'incorrect', 1); // 50% -> hard
  insertQuestion(db, 'exhard1', 'ca_notary');  insertProgress(db, 'u1', 'exhard1', 10, 2, 'incorrect', 1); // 20% -> extremely_hard
  insertQuestion(db, 'lowsample1', 'ca_notary'); insertProgress(db, 'u1', 'lowsample1', 2, 2, 'correct', 1); // 100% but only 2 samples -> moderate
  insertQuestion(db, 'untouched1', 'ca_notary'); // no progress row at all -> moderate

  const env = { DB: makeD1(db) };
  const index = await getDifficultyIndex(env);
  const notary = index.get('ca_notary');
  assert.deepEqual(notary.get('easy').sort(), ['easy1']);
  assert.deepEqual(notary.get('moderate').sort(), ['lowsample1', 'mod1', 'untouched1']);
  assert.deepEqual(notary.get('hard').sort(), ['hard1']);
  assert.deepEqual(notary.get('extremely_hard').sort(), ['exhard1']);
});

test('getDifficultyIndex: cross-track isolation -- one exam_type\'s bands never include another\'s questions', async () => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'n1', 'ca_notary'); insertProgress(db, 'u1', 'n1', 10, 9, 'correct', 1); // easy
  insertQuestion(db, 'd1', 'ca_driver'); insertProgress(db, 'u1', 'd1', 10, 9, 'correct', 1); // easy, same band, different track

  const env = { DB: makeD1(db) };
  const index = await getDifficultyIndex(env);
  assert.deepEqual(index.get('ca_notary').get('easy'), ['n1']);
  assert.deepEqual(index.get('ca_driver').get('easy'), ['d1']);
});

test('getDifficultyIndex: second call within the TTL serves cached data and never re-queries the database', async () => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'n1', 'ca_notary'); insertProgress(db, 'u1', 'n1', 10, 9, 'correct', 1);
  const env = { DB: makeD1(db) };

  const first = await getDifficultyIndex(env);
  const countAfterFirst = env.DB.prepareCount;
  assert.ok(countAfterFirst > 0);
  assert.deepEqual(first.get('ca_notary').get('easy'), ['n1']);

  db.prepare('INSERT INTO questions (id, exam_type, topic) VALUES (?,?,?)').run('n2', 'ca_notary', 'General');
  db.prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)').run('u1', 'n2', 10, 9, 'correct', null, 1);
  const countBeforeSecondCall = env.DB.prepareCount;

  const second = await getDifficultyIndex(env);
  assert.equal(env.DB.prepareCount, countBeforeSecondCall, 'a cached second call must not issue any new prepare() calls at all');
  assert.deepEqual(second.get('ca_notary').get('easy'), ['n1'], 'still the pre-mutation data, not the newly-inserted n2');

  _resetDifficultyIndexCacheForTests();
  const third = await getDifficultyIndex(env);
  assert.deepEqual(third.get('ca_notary').get('easy').sort(), ['n1', 'n2'], 'once fresh, the response must reflect the mutation made while the cache was warm');
});

test('findNextQuestionRow: difficulty filter combined with exclude-last-answered picks the right row (bind-order regression guard)', async () => {
  // All 3 questions already have progress rows (unseen pool empty), forcing the missed/review
  // path -- the one most likely to have a bind-order bug, since json_each(?) sits between the
  // p.user_id=? and q.id!=? parameters in that query's text.
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'qA', 'ca_notary'); insertProgress(db, 'u1', 'qA', 10, 9, 'incorrect', 200); // easy, most recently answered
  insertQuestion(db, 'qB', 'ca_notary'); insertProgress(db, 'u1', 'qB', 10, 8, 'incorrect', 100); // easy
  insertQuestion(db, 'qC', 'ca_notary'); insertProgress(db, 'u1', 'qC', 10, 2, 'incorrect', 50);  // extremely_hard, not in the 'easy' band at all
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_notary' };

  const row = await findNextQuestionRow(env, user, 'easy');
  assert.ok(row, 'must find a match -- qB is a valid easy-band, non-excluded, missed question');
  assert.equal(row.id, 'qB', 'qA is the most-recently-answered question and must be excluded even though it is also in the easy band; qC is excluded by band, not by the exclude filter');
});

test('findNextQuestionRow: falls through to the review pool when nothing is missed, still band-filtered', async () => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'qA', 'ca_notary'); insertProgress(db, 'u1', 'qA', 10, 9, 'correct', 100); // easy, no wrong answers anywhere
  insertQuestion(db, 'qB', 'ca_notary'); insertProgress(db, 'u1', 'qB', 10, 2, 'correct', 50);   // extremely_hard
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_notary' };

  const row = await findNextQuestionRow(env, user, 'easy');
  assert.ok(row);
  assert.equal(row.id, 'qA', 'unseen pool is empty (both answered) and nothing is missed, so this must fall through to the review pool, still correctly filtered to the easy band');
});

test('findNextQuestionRow: an empty band (no questions match) returns null, not a SQL error', async () => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'qA', 'ca_notary'); insertProgress(db, 'u1', 'qA', 10, 9, 'correct', 100); // easy only
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_notary' };

  const row = await findNextQuestionRow(env, user, 'extremely_hard');
  assert.equal(row, null, 'no question in this track is extremely_hard -- json_each on an empty id list must join zero rows, not throw');
});

test('findNextQuestionRow: unfiltered (no difficulty) still picks an unseen question first, unaffected by the rewrite', async () => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'seen1', 'ca_notary'); insertProgress(db, 'u1', 'seen1', 10, 9, 'correct', 100);
  insertQuestion(db, 'unseen1', 'ca_notary'); // never answered
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_notary' };

  const row = await findNextQuestionRow(env, user, null);
  assert.ok(row);
  assert.equal(row.id, 'unseen1', 'unseen-first behavior must be unchanged when no difficulty filter is requested');
});
