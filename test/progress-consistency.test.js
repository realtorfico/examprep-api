// Regression test for the 2026-08-05 progress-counter bug: the site's headline totals, the
// site's own byTopic breakdown, admin's per-user view, and admin's global accuracy-by-topic all
// read from `progress` but used to disagree because some queries counted distinct questions
// (COUNT(*)/last_result) while others counted cumulative attempts (SUM(times_seen/times_correct)).
// This runs the actual shared SQL from progressQueries.js against an in-memory SQLite database
// (Node's built-in node:sqlite -- no wrangler/workerd needed, which matters since this machine
// can't run those locally at all, see root CLAUDE.md) and asserts every view agrees.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  PROGRESS_TOTALS_SQL,
  PROGRESS_BY_TOPIC_SQL,
  CONSOLE_QUIZ_PROGRESS_SQL,
  STATS_ACCURACY_BY_TOPIC_SQL,
} from '../src/progressQueries.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, exam_type TEXT);
    CREATE TABLE codes (code TEXT PRIMARY KEY, redeemed_by TEXT, buyer_email TEXT);
    CREATE TABLE questions (id TEXT PRIMARY KEY, exam_type TEXT, topic TEXT);
    CREATE TABLE progress (
      user_id TEXT, question_id TEXT, times_seen INTEGER, times_correct INTEGER,
      last_result TEXT, PRIMARY KEY (user_id, question_id)
    );
  `);

  db.prepare('INSERT INTO users VALUES (?, ?)').run('u1', 'notary');
  db.prepare('INSERT INTO users VALUES (?, ?)').run('u2', 'notary');
  db.prepare('INSERT INTO codes VALUES (?, ?, ?)').run('CODE1', 'u1', 'a@example.com');
  db.prepare('INSERT INTO codes VALUES (?, ?, ?)').run('CODE2', 'u2', 'b@example.com');

  const questions = [
    ['q1', 'notary', 'Fees'],
    ['q2', 'notary', 'Fees'],
    ['q3', 'notary', 'Journal'],
  ];
  for (const q of questions) db.prepare('INSERT INTO questions VALUES (?, ?, ?)').run(...q);

  // u1/q1: missed once, resurfaced, missed again, then finally gotten right -- 3 attempts,
  // 1 correct -- this is exactly the "resurfaced miss" scenario the original bug ate: the row's
  // last_result is 'correct' (looks fully mastered) but 2 of the 3 attempts were wrong.
  db.prepare('INSERT INTO progress VALUES (?, ?, ?, ?, ?)').run('u1', 'q1', 3, 1, 'correct');
  // u1/q2: single fresh wrong attempt, never retried.
  db.prepare('INSERT INTO progress VALUES (?, ?, ?, ?, ?)').run('u1', 'q2', 1, 0, 'incorrect');
  // u1/q3: single fresh correct attempt.
  db.prepare('INSERT INTO progress VALUES (?, ?, ?, ?, ?)').run('u1', 'q3', 1, 1, 'correct');
  // u2/q1: different user, shouldn't leak into u1's totals.
  db.prepare('INSERT INTO progress VALUES (?, ?, ?, ?, ?)').run('u2', 'q1', 2, 2, 'correct');

  return db;
}

test('headline totals equal the sum of the byTopic breakdown for the same user', () => {
  const db = makeDb();
  const totals = db.prepare(PROGRESS_TOTALS_SQL).get('u1');
  const byTopic = db.prepare(PROGRESS_BY_TOPIC_SQL).all('u1');

  const topicTotal = byTopic.reduce((sum, row) => sum + row.total, 0);
  const topicCorrect = byTopic.reduce((sum, row) => sum + row.correct, 0);

  assert.equal(totals.total, 5, 'u1 attempted 3 + 1 + 1 = 5 times total');
  assert.equal(totals.correct, 2, 'u1 got 1 + 0 + 1 = 2 of those attempts correct');
  assert.equal(topicTotal, totals.total, 'byTopic totals must sum to the headline total');
  assert.equal(topicCorrect, totals.correct, 'byTopic corrects must sum to the headline correct');
});

test('a resurfaced-then-corrected question still counts its earlier misses', () => {
  // This is the original bug: q1's current state is "correct", but it was missed twice getting
  // there. A distinct-question/last_result count would report 0 wrong for q1; attempts-based
  // reporting must report 2.
  const db = makeDb();
  const totals = db.prepare(PROGRESS_TOTALS_SQL).get('u1');
  assert.equal(totals.total - totals.correct, 3, 'u1 has 3 wrong attempts total (2 from q1, 1 from q2)');
});

test("admin's per-user per-topic view matches the student's own headline totals", () => {
  const db = makeDb();
  const totals = db.prepare(PROGRESS_TOTALS_SQL).get('u1');
  const consoleRows = db.prepare(CONSOLE_QUIZ_PROGRESS_SQL).all().filter((r) => r.user_id === 'u1');

  const adminTotal = consoleRows.reduce((sum, row) => sum + row.total, 0);
  const adminCorrect = consoleRows.reduce((sum, row) => sum + row.correct, 0);

  assert.equal(adminTotal, totals.total, "admin's total for u1 must match u1's own headline total");
  assert.equal(adminCorrect, totals.correct, "admin's correct for u1 must match u1's own headline correct");
});

test("admin's global accuracy-by-topic matches the per-user breakdowns summed across users", () => {
  const db = makeDb();
  const global = db.prepare(STATS_ACCURACY_BY_TOPIC_SQL).all();
  const consoleRows = db.prepare(CONSOLE_QUIZ_PROGRESS_SQL).all();

  for (const topicRow of global) {
    const matching = consoleRows.filter((r) => r.topic === topicRow.topic);
    const expectedAttempts = matching.reduce((sum, row) => sum + row.total, 0);
    const expectedCorrect = matching.reduce((sum, row) => sum + row.correct, 0);
    assert.equal(topicRow.attempts, expectedAttempts, `topic "${topicRow.topic}" attempts must match summed per-user rows`);
    assert.equal(topicRow.correct, expectedCorrect, `topic "${topicRow.topic}" correct must match summed per-user rows`);
  }
});
