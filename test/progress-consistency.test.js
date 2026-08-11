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
  LEADERBOARD_SQL,
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
    CREATE TABLE exam_attempts (
      id TEXT PRIMARY KEY, user_id TEXT, exam_type TEXT, submitted_at INTEGER
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
  const byTopic = db.prepare(PROGRESS_BY_TOPIC_SQL).all('u1', 'notary');

  const topicTotal = byTopic.reduce((sum, row) => sum + row.total, 0);
  const topicCorrect = byTopic.reduce((sum, row) => sum + row.correct, 0);

  assert.equal(totals.total, 5, 'u1 attempted 3 + 1 + 1 = 5 times total');
  assert.equal(totals.correct, 2, 'u1 got 1 + 0 + 1 = 2 of those attempts correct');
  assert.equal(topicTotal, totals.total, 'byTopic totals must sum to the headline total');
  assert.equal(topicCorrect, totals.correct, 'byTopic corrects must sum to the headline correct');
});

test('byTopic includes every topic in the exam, even ones the user has never touched (0% coverage)', () => {
  const db = makeDb();
  // q4 is a brand-new topic ('Bonds') u1 has never seen -- LEFT JOIN from questions must still
  // surface it (seen: 0, topicTotal: 1), not silently omit it the way an INNER JOIN from progress
  // would. This is the whole point of the coverage feature: a completely untouched topic is
  // exactly the 0%-coverage case it needs to surface.
  db.prepare('INSERT INTO questions VALUES (?, ?, ?)').run('q4', 'notary', 'Bonds');
  const byTopic = db.prepare(PROGRESS_BY_TOPIC_SQL).all('u1', 'notary');

  const bonds = byTopic.find((r) => r.topic === 'Bonds');
  assert.ok(bonds, 'Bonds must appear in byTopic even though u1 has never attempted it');
  assert.equal(bonds.seen, 0);
  assert.equal(bonds.topicTotal, 1);
  assert.equal(bonds.total, 0);
  assert.equal(bonds.correct, 0);

  const fees = byTopic.find((r) => r.topic === 'Fees');
  assert.equal(fees.seen, 2, 'u1 has attempted both q1 and q2, the only two Fees questions');
  assert.equal(fees.topicTotal, 2);
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

test("admin's per-user view includes an active user's untouched topics too (0% coverage), but skips fully-inactive users", () => {
  const db = makeDb();
  db.prepare('INSERT INTO questions VALUES (?, ?, ?)').run('q4', 'notary', 'Bonds');
  db.prepare('INSERT INTO users VALUES (?, ?)').run('u3', 'notary'); // never answered anything
  const consoleRows = db.prepare(CONSOLE_QUIZ_PROGRESS_SQL).all();

  const u1Bonds = consoleRows.find((r) => r.user_id === 'u1' && r.topic === 'Bonds');
  assert.ok(u1Bonds, 'u1 is active (has other progress), so their untouched Bonds topic must still appear');
  assert.equal(u1Bonds.seen, 0);
  assert.equal(u1Bonds.topicTotal, 1);

  assert.ok(!consoleRows.some((r) => r.user_id === 'u3'), 'u3 has never answered anything and must not appear at all');
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

// ---- Multi-track isolation ------------------------------------------------------------
// Regression coverage for the 2026-08-10 cross-track bugs (an account bound to one track
// briefly showing another track's UI/resources -- see [[examprep_track_addition_playbook]]).
// makeDb() above only ever had ONE exam_type in its fixture, so a query that accidentally
// dropped/forgot a `WHERE exam_type = ?`/`JOIN ... ON exam_type = ...` clause had no way to be
// caught -- there was nothing else in the fixture for it to leak from. This fixture adds a
// second track (ca_driver) with its own users/questions/progress, deliberately including a
// topic NAMED THE SAME in both tracks ("General"), so a query that grouped by topic alone
// (forgetting to also group/filter by exam_type) would visibly merge two tracks' stats together.
function makeMultiTrackDb() {
  const db = makeDb(); // seeds notary: u1/u2, q1-q3 (Fees/Fees/Journal), as already tested above

  db.prepare('INSERT INTO users VALUES (?, ?)').run('d1', 'ca_driver');
  db.prepare('INSERT INTO users VALUES (?, ?)').run('d2', 'ca_driver');
  db.prepare('INSERT INTO codes VALUES (?, ?, ?)').run('DCODE1', 'd1', 'c@example.com');
  db.prepare('INSERT INTO codes VALUES (?, ?, ?)').run('DCODE2', 'd2', 'd@example.com');

  const driverQuestions = [
    ['dq1', 'ca_driver', 'General'], // same topic NAME as notary would use if it had one -- deliberate
    ['dq2', 'ca_driver', 'General'],
    ['dq3', 'ca_driver', 'Signs'],
  ];
  for (const q of driverQuestions) db.prepare('INSERT INTO questions VALUES (?, ?, ?)').run(...q);

  // d1: strong performer (mirrors u1's shape but on the OTHER track) -- if any notary query leaked
  // into this, u1's own totals (5 attempts/2 correct) would visibly change when this runs.
  db.prepare('INSERT INTO progress VALUES (?, ?, ?, ?, ?)').run('d1', 'dq1', 4, 4, 'correct');
  db.prepare('INSERT INTO progress VALUES (?, ?, ?, ?, ?)').run('d1', 'dq2', 2, 1, 'correct');
  db.prepare('INSERT INTO progress VALUES (?, ?, ?, ?, ?)').run('d2', 'dq1', 1, 0, 'incorrect');

  return db;
}

test("a track's headline totals are unaffected by another track's data existing at all", () => {
  const soloTotals = db_prepare_totals(makeDb());
  const withOtherTrackTotals = db_prepare_totals(makeMultiTrackDb());
  assert.deepEqual(withOtherTrackTotals, soloTotals,
    "u1's totals must be identical whether or not ca_driver data exists in the same database");
  function db_prepare_totals(db) { return db.prepare(PROGRESS_TOTALS_SQL).get('u1'); }
});

test('PROGRESS_BY_TOPIC_SQL never mixes another track\'s identically-named topic into this one\'s breakdown', () => {
  const db = makeMultiTrackDb();
  const notaryByTopic = db.prepare(PROGRESS_BY_TOPIC_SQL).all('u1', 'notary');
  const driverByTopic = db.prepare(PROGRESS_BY_TOPIC_SQL).all('d1', 'ca_driver');

  assert.ok(!notaryByTopic.some((r) => r.topic === 'General'), 'notary has no "General" topic of its own -- ca_driver\'s must not leak in');
  assert.ok(!driverByTopic.some((r) => r.topic === 'Fees' || r.topic === 'Journal'), "ca_driver's breakdown must not include notary's topics");

  const driverGeneral = driverByTopic.find((r) => r.topic === 'General');
  assert.equal(driverGeneral.total, 6, 'd1 attempted dq1(4) + dq2(2) = 6 times');
  assert.equal(driverGeneral.correct, 5, 'd1 got dq1(4) + dq2(1) = 5 correct');
});

test('LEADERBOARD_SQL only ever includes users from the requested track, even when another track has stronger stats', () => {
  const db = makeMultiTrackDb();
  const notaryBoard = db.prepare(LEADERBOARD_SQL).all('notary');
  const driverBoard = db.prepare(LEADERBOARD_SQL).all('ca_driver');

  assert.ok(notaryBoard.every((r) => ['u1', 'u2'].includes(r.user_id)), 'notary leaderboard must only contain notary users');
  assert.ok(driverBoard.every((r) => ['d1', 'd2'].includes(r.user_id)), 'ca_driver leaderboard must only contain ca_driver users');
  assert.ok(!notaryBoard.some((r) => r.user_id === 'd1'), "d1 (100% accuracy on ca_driver) must not appear on notary's leaderboard despite outscoring every notary user");
});

test("admin's per-user view keeps each user's rows scoped to their own exam_type's topics only", () => {
  const db = makeMultiTrackDb();
  const consoleRows = db.prepare(CONSOLE_QUIZ_PROGRESS_SQL).all();

  const u1Rows = consoleRows.filter((r) => r.user_id === 'u1');
  const d1Rows = consoleRows.filter((r) => r.user_id === 'd1');
  assert.ok(u1Rows.every((r) => r.exam_type === 'notary'), "u1's admin rows must all say exam_type='notary'");
  assert.ok(d1Rows.every((r) => r.exam_type === 'ca_driver'), "d1's admin rows must all say exam_type='ca_driver'");
  assert.ok(!u1Rows.some((r) => r.topic === 'General' || r.topic === 'Signs'), "u1 (notary) must not show ca_driver's topics");
});

test("admin's global accuracy-by-topic keeps two tracks' identically-named topics as separate rows, not merged", () => {
  const db = makeMultiTrackDb();
  const global = db.prepare(STATS_ACCURACY_BY_TOPIC_SQL).all();

  const generalRows = global.filter((r) => r.topic === 'General');
  assert.equal(generalRows.length, 1, 'only ca_driver has a "General" topic in this fixture, so exactly one row, not merged with anything else');
  assert.equal(generalRows[0].exam_type, 'ca_driver');
  assert.equal(generalRows[0].attempts, 7, "d1's 6 (dq1:4 + dq2:2) + d2's 1 (dq1:1) = 7, summed across ALL ca_driver users");
  assert.equal(generalRows[0].correct, 5, "d1's 5 (dq1:4 + dq2:1) + d2's 0 = 5");

  const feesRows = global.filter((r) => r.topic === 'Fees');
  assert.equal(feesRows.length, 1);
  assert.equal(feesRows[0].exam_type, 'notary', 'Fees must stay attributed to notary, not get merged into ca_driver');
});
