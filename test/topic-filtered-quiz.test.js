// Regression coverage for topic-scoped quiz question selection -- the à la carte topic-purchase
// pilot's (CA CDL) quiz-mode piece. findNextQuestionRow gained an optional 4th `topics` param
// (array of exact-match questions.topic strings, joined via json_each(?) same as the existing
// difficulty-band filter), and users.owned_topics_json (NULL = full access, the default for every
// existing user) feeds it via ownedTopicsFor()/handleNextQuestion.
//
// This is high-risk in the same way the 2026-09-11 difficulty-index rewrite was (see
// difficulty-index-caching.test.js's own docstring): findNextQuestionRow is the live quiz engine
// for every user on every track, and adding a second json_each(?) join means TWO bind-order-
// sensitive parameters can now combine. The highest-value test here is difficulty + topic
// combined, since that's the case most likely to silently return the wrong row (or throw) if the
// bind order in the SQL text doesn't exactly match the bind() call's argument order.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { findNextQuestionRow, ownedTopicsFor, _resetDifficultyIndexCacheForTests } from '../src/index.js';

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
    CREATE TABLE questions (id TEXT PRIMARY KEY, exam_type TEXT, topic TEXT, weight INTEGER DEFAULT 1,
      question TEXT, choice_a TEXT, choice_b TEXT, choice_c TEXT, choice_d TEXT, correct_choice TEXT, explanation TEXT);
    CREATE TABLE progress (
      user_id TEXT, question_id TEXT, times_seen INTEGER, times_correct INTEGER,
      last_result TEXT, last_choice TEXT, last_answered_at INTEGER, PRIMARY KEY (user_id, question_id)
    );
  `);
  return db;
}

function insertQuestion(db, id, examType, topic, weight) {
  db.prepare('INSERT INTO questions (id, exam_type, topic, weight, question, choice_a, choice_b, choice_c, choice_d, correct_choice) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, examType, topic, weight || 1, 'Q?', 'A', 'B', 'C', 'D', 'A');
}
function insertProgress(db, userId, questionId, seen, correct, lastResult, lastAnsweredAt) {
  db.prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)')
    .run(userId, questionId, seen, correct, lastResult || null, null, lastAnsweredAt || null);
}

test('ownedTopicsFor: NULL owned_topics_json (every existing user) means unrestricted', () => {
  assert.equal(ownedTopicsFor({ owned_topics_json: null }), null);
});
test('ownedTopicsFor: a real JSON array of topics is parsed', () => {
  assert.deepEqual(ownedTopicsFor({ owned_topics_json: '["General Knowledge","Air Brakes"]' }), ['General Knowledge', 'Air Brakes']);
});
test('ownedTopicsFor: malformed JSON degrades to unrestricted, never throws', () => {
  assert.equal(ownedTopicsFor({ owned_topics_json: 'not json' }), null);
});
test('ownedTopicsFor: an empty array degrades to unrestricted (would otherwise lock the buyer out entirely)', () => {
  assert.equal(ownedTopicsFor({ owned_topics_json: '[]' }), null);
});

test('findNextQuestionRow: topic filter restricts the unseen pool to only the owned topics', async (t) => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'gk1', 'ca_cdl', 'General Knowledge');
  insertQuestion(db, 'ab1', 'ca_cdl', 'Air Brakes'); // not owned -- must never be selected
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl' };

  for (let i = 0; i < 10; i++) {
    const row = await findNextQuestionRow(env, user, null, ['General Knowledge']);
    assert.equal(row.id, 'gk1', 'the only owned-topic question must always be picked, never ab1');
  }
});

test('findNextQuestionRow: no topics (null/undefined) is unrestricted, unchanged from before this feature', async (t) => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'gk1', 'ca_cdl', 'General Knowledge');
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl' };

  const row = await findNextQuestionRow(env, user, null, null);
  assert.ok(row, 'a full-access (null topics) call must still find the unseen question');
  assert.equal(row.id, 'gk1');
});

test('findNextQuestionRow: an exhausted owned-topic pool falls back to re-serving its own history, never leaking another topic\'s question', async (t) => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'gk1', 'ca_cdl', 'General Knowledge');
  insertProgress(db, 'u1', 'gk1', 5, 5, 'correct', 100); // already seen, no wrong answers -- unseen/missed pools both empty
  insertQuestion(db, 'ab1', 'ca_cdl', 'Air Brakes'); // real question exists in the track, just not an owned topic
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl' };

  const row = await findNextQuestionRow(env, user, null, ['General Knowledge']);
  // Same "re-serve from history rather than dead-end" behavior a full, unfiltered track already
  // has once every question is answered -- gk1 has a progress row so it's a valid review-pool
  // candidate; the real assertion is that ab1 (wrong topic) can never be the one returned, even
  // as a last resort.
  assert.ok(row, 'must fall back to the review pool rather than returning null while gk1 still has a progress row');
  assert.equal(row.id, 'gk1', 'must never leak ab1 (wrong topic) even as a last-resort review pick');
});

test('findNextQuestionRow: a track with NO progress at all in the owned topic returns null, not another topic\'s question', async (t) => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  // No General Knowledge questions exist at all for this user to draw from (the owned topic has
  // zero content in this DB) -- only a different topic's question exists.
  insertQuestion(db, 'ab1', 'ca_cdl', 'Air Brakes');
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl' };

  const row = await findNextQuestionRow(env, user, null, ['General Knowledge']);
  assert.equal(row, null, 'nothing in the owned scope exists at all -- must return null, never ab1');
});

test('findNextQuestionRow: difficulty + topic combined picks the right row (bind-order regression guard)', async (t) => {
  // Two json_each(?) joins in the same query now -- the highest-risk combination this feature
  // introduces. All questions already have progress (unseen pool empty), forcing the
  // missed/exclude-filter path, same reasoning as the equivalent difficulty-only test.
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'qA', 'ca_cdl', 'General Knowledge'); insertProgress(db, 'u1', 'qA', 10, 9, 'incorrect', 200); // easy, GK, most recently answered
  insertQuestion(db, 'qB', 'ca_cdl', 'General Knowledge'); insertProgress(db, 'u1', 'qB', 10, 8, 'incorrect', 100); // easy, GK -- the only valid match
  insertQuestion(db, 'qC', 'ca_cdl', 'Air Brakes');        insertProgress(db, 'u1', 'qC', 10, 8, 'incorrect', 50);  // easy, but NOT an owned topic
  insertQuestion(db, 'qD', 'ca_cdl', 'General Knowledge'); insertProgress(db, 'u1', 'qD', 10, 2, 'incorrect', 25);  // extremely_hard, GK -- wrong band
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl' };

  const row = await findNextQuestionRow(env, user, 'easy', ['General Knowledge']);
  assert.ok(row, 'qB satisfies band + topic + not-excluded');
  assert.equal(row.id, 'qB', 'qA excluded (last answered), qC excluded (wrong topic), qD excluded (wrong band) -- only qB matches all three filters at once');
});

test('findNextQuestionRow: unseen-pool query also respects difficulty + topic combined', async (t) => {
  _resetDifficultyIndexCacheForTests();
  const db = makeDb();
  insertQuestion(db, 'gkEasy', 'ca_cdl', 'General Knowledge'); // easy (no progress = moderate default)... use explicit progress to control band
  insertProgress(db, 'u1', 'gkEasy', 10, 9, 'correct', 100); // easy band, but SEEN -- must not be picked by the unseen-pool query
  insertQuestion(db, 'gkUnseen', 'ca_cdl', 'General Knowledge'); // never answered -- moderate band (no samples), unseen
  insertQuestion(db, 'abUnseen', 'ca_cdl', 'Air Brakes'); // never answered, moderate band, wrong topic
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl' };

  const row = await findNextQuestionRow(env, user, 'moderate', ['General Knowledge']);
  assert.ok(row);
  assert.equal(row.id, 'gkUnseen', 'must pick the unseen GK question in the moderate band, not the seen easy-band GK question or the unseen Air Brakes question');
});
