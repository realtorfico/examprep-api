// SECURITY: a logged-in customer must only ever reach questions (text, choices, correct answer,
// explanation) from the track they bought -- and, for an à la carte buyer, only the topics they
// bought. Written 2026-09-16 after an audit found that ANY login could read ANY question site-wide:
// /answer accepted any questionId with no track/topic check (and recorded it as progress), and
// /progress's wrong-answer list plus /questions/next's missed/review picks weren't scoped to the
// user's track -- so answering a guessed ID (e.g. "tx_cdl-b1-001") wrong, then opening Progress,
// returned the full question and answer.
//
// These go through the real router (see _harness.js), so auth + routing + handler are all covered.
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, call } from './_harness.js';
import { seedPaidContent, progressRow, assertNoPaidMarkers, TOKENS, USERS } from './_paid-content-fixture.js';

function setup() {
  const db = makeDb();
  seedPaidContent(db);
  return { db, env: makeEnv(db) };
}
const progressCount = (db, userId, questionId) =>
  db.prepare('SELECT COUNT(*) AS n FROM progress WHERE user_id = ? AND question_id = ?').get(userId, questionId).n;

// ---- /answer ------------------------------------------------------------------------------------

test('/answer: a customer of another track cannot answer (and so cannot read the answer to) a question from a track they did not buy', async () => {
  const { db, env } = setup();
  const res = await call(env, 'POST', '/answer', { token: TOKENS.notary, body: { questionId: 'ca_cdl-b1-101', choice: 'B' } });
  assert.equal(res.status, 404);
  assertNoPaidMarkers(assert, res.text, 'foreign-track /answer');
  assert.ok(!('correctChoice' in (res.json || {})), 'must not reveal the correct answer');
  assert.equal(progressCount(db, USERS.notary, 'ca_cdl-b1-101'), 0, 'must not record progress for a foreign question');
});

test('/answer: an à la carte buyer cannot answer a question from a topic they did not buy', async () => {
  const { db, env } = setup();
  const res = await call(env, 'POST', '/answer', { token: TOKENS.topic, body: { questionId: 'ca_cdl-b1-201', choice: 'B' } });
  assert.equal(res.status, 404);
  assertNoPaidMarkers(assert, res.text, 'unowned-topic /answer');
  assert.equal(progressCount(db, USERS.topic, 'ca_cdl-b1-201'), 0);
});

test('/answer: still works for the buyer\'s own track, and for an à la carte buyer\'s owned topic', async () => {
  const { env } = setup();
  const full = await call(env, 'POST', '/answer', { token: TOKENS.full, body: { questionId: 'ca_cdl-b1-201', choice: 'B' } });
  assert.equal(full.status, 200);
  assert.ok(full.json.correctChoice, 'full-track owner gets the answer for any question on their track');
  const topic = await call(env, 'POST', '/answer', { token: TOKENS.topic, body: { questionId: 'ca_cdl-b1-101', choice: 'B' } });
  assert.equal(topic.status, 200);
  assert.ok(topic.json.explanation.includes('ca_cdl owned 101'));
});

// ---- /progress ----------------------------------------------------------------------------------

test('/progress: the wrong-answer list never includes another track\'s question, even if a progress row for it exists', async () => {
  // A row like this is exactly what the old /answer hole left behind (and could still exist in
  // production data from before the fix) -- the list must be scoped at read time too.
  const { db, env } = setup();
  progressRow(db, USERS.notary, 'ca_cdl-b1-101', 'incorrect', 100);
  progressRow(db, USERS.notary, 'tx_notary-b1-101', 'incorrect', 90);
  const res = await call(env, 'GET', '/progress', { token: TOKENS.notary });
  assert.equal(res.status, 200);
  const ids = res.json.wrongQuestions.map((w) => w.id);
  assert.ok(!ids.includes('ca_cdl-b1-101'), 'foreign-track question must not be listed');
  assert.ok(ids.includes('tx_notary-b1-101'), 'own-track missed question is still listed');
  assert.ok(!res.text.includes('ca_cdl'), 'no trace of the foreign track in the response');
});

test('/progress: an à la carte buyer\'s wrong-answer list never includes an un-owned topic\'s question', async () => {
  const { db, env } = setup();
  progressRow(db, USERS.topic, 'ca_cdl-b1-201', 'incorrect', 100);
  progressRow(db, USERS.topic, 'ca_cdl-b1-101', 'incorrect', 90);
  const res = await call(env, 'GET', '/progress', { token: TOKENS.topic });
  assert.equal(res.status, 200);
  const ids = res.json.wrongQuestions.map((w) => w.id);
  assert.ok(!ids.includes('ca_cdl-b1-201'), 'un-owned topic question must not be listed');
  assert.ok(ids.includes('ca_cdl-b1-101'), 'owned topic missed question is still listed');
  assert.ok(!res.text.includes('unowned'), 'no trace of un-owned topic content in the response');
});

// ---- /questions/next ----------------------------------------------------------------------------

test('/questions/next: never serves another track\'s question out of the user\'s progress history', async () => {
  const { db, env } = setup();
  // Every own-track question already answered correctly, so the picker falls through to its
  // missed/review branches -- the ones that used to join progress without a track filter.
  const own = db.prepare("SELECT id FROM questions WHERE exam_type = 'tx_notary'").all();
  own.forEach((row, i) => progressRow(db, USERS.notary, row.id, 'correct', 1000 + i));
  progressRow(db, USERS.notary, 'ca_cdl-b1-102', 'incorrect', 10);
  for (let i = 0; i < 25; i++) {
    const res = await call(env, 'GET', '/questions/next', { token: TOKENS.notary });
    assertNoPaidMarkers(assert, res.text.replace(/PAID-QUESTION tx_notary/g, ''), `/questions/next call ${i + 1}`);
    if (res.json && res.json.id) assert.ok(res.json.id.startsWith('tx_notary-'), `served foreign question ${res.json.id}`);
  }
});

// ---- Mock exam (regression guards -- verified correct in the 2026-09-16 audit) -------------------

test('/exam/start: only the buyer\'s own track, and no answers or explanations before submitting', async () => {
  const { env } = setup();
  const res = await call(env, 'POST', '/exam/start', { token: TOKENS.notary, body: {} });
  assert.equal(res.status, 200);
  assert.ok(res.json.questions.length > 0);
  res.json.questions.forEach((q) => assert.ok(q.id.startsWith('tx_notary-'), `foreign exam question ${q.id}`));
  assert.ok(!/correctChoice|correct_choice|explanation|EXPLANATION|SECRET/.test(res.text), 'no answers/explanations before submit');
});

test('/exam/start: an à la carte buyer cannot start a full mock exam', async () => {
  const { env } = setup();
  const res = await call(env, 'POST', '/exam/start', { token: TOKENS.topic, body: {} });
  assert.equal(res.status, 403);
  assertNoPaidMarkers(assert, res.text, 'à la carte /exam/start');
});

test('/exam/attempt: a customer cannot open someone else\'s submitted attempt (which includes answers)', async () => {
  const { env } = setup();
  const started = await call(env, 'POST', '/exam/start', { token: TOKENS.full, body: {} });
  await call(env, 'POST', '/exam/submit', { token: TOKENS.full, body: { attemptId: started.json.attemptId } });
  const res = await call(env, 'GET', '/exam/attempt?attemptId=' + started.json.attemptId, { token: TOKENS.notary });
  assert.equal(res.status, 404);
  assertNoPaidMarkers(assert, res.text, 'foreign /exam/attempt');
});

test('quiz and exam endpoints reject requests with no login or a fake token', async () => {
  const { env } = setup();
  for (const [method, path, body] of [
    ['GET', '/questions/next'], ['POST', '/answer', { questionId: 'ca_cdl-b1-101', choice: 'A' }], ['GET', '/progress'],
    ['POST', '/exam/start', {}], ['GET', '/exam/attempt?attemptId=x'],
  ]) {
    for (const token of [undefined, 'not-a-real-token']) {
      const res = await call(env, method, path, { token, body });
      assert.equal(res.status, 401, `${method} ${path} with ${token ? 'fake token' : 'no token'}`);
    }
  }
});

// ---- More guards: à la carte quiz scope, exam edge cases, revoked/expired logins -----------------

test('/questions/next: an à la carte buyer is never served an un-owned topic, even with un-owned rows in their history', async () => {
  const { db, env } = setup();
  const owned = db.prepare("SELECT id FROM questions WHERE exam_type = 'ca_cdl' AND topic LIKE 'Air Brakes%'").all();
  owned.forEach((row, i) => progressRow(db, USERS.topic, row.id, 'correct', 1000 + i));
  progressRow(db, USERS.topic, 'ca_cdl-b1-202', 'incorrect', 10);
  for (let i = 0; i < 25; i++) {
    const res = await call(env, 'GET', '/questions/next', { token: TOKENS.topic });
    assert.equal(res.status, 200, 'must still serve owned-topic questions (otherwise this test proves nothing)');
    assert.ok(!res.text.includes('unowned'), `call ${i + 1} served an un-owned topic question`);
  }
});

test('/exam/current and /exam/answer: no answers before submitting, and no access to someone else\'s in-progress attempt', async () => {
  const { env } = setup();
  const started = await call(env, 'POST', '/exam/start', { token: TOKENS.full, body: {} });
  const current = await call(env, 'GET', '/exam/current', { token: TOKENS.full });
  assert.equal(current.status, 200);
  assert.ok(!/correctChoice|explanation|EXPLANATION|SECRET/.test(current.text), 'in-progress attempt must not include answers');
  const foreignAnswer = await call(env, 'POST', '/exam/answer', { token: TOKENS.notary, body: { attemptId: started.json.attemptId, questionId: started.json.questions[0].id, choice: 'A' } });
  assert.equal(foreignAnswer.status, 404);
  const foreignSubmit = await call(env, 'POST', '/exam/submit', { token: TOKENS.notary, body: { attemptId: started.json.attemptId } });
  assert.equal(foreignSubmit.status, 404);
  assertNoPaidMarkers(assert, foreignSubmit.text, 'foreign /exam/submit');
});

test('/exam/submit: the review only covers the attempt\'s own questions, even if answers were recorded for other question ids', async () => {
  const { env } = setup();
  const started = await call(env, 'POST', '/exam/start', { token: TOKENS.notary, body: {} });
  await call(env, 'POST', '/exam/answer', { token: TOKENS.notary, body: { attemptId: started.json.attemptId, questionId: 'ca_cdl-b1-101', choice: 'A' } });
  const submitted = await call(env, 'POST', '/exam/submit', { token: TOKENS.notary, body: { attemptId: started.json.attemptId } });
  assert.equal(submitted.status, 200);
  assert.ok(submitted.json.review.length > 0 && /EXPLANATION tx_notary|SECRET tx_notary/.test(submitted.text), 'review must include the attempt\'s own answers (otherwise this test proves nothing)');
  assert.ok(!submitted.text.includes('ca_cdl'), 'foreign question id recorded as an answer must not appear in the review');
});

test('/exam/start Weak Spots: drawn only from the buyer\'s own track, even with another track\'s missed questions in their history', async () => {
  const { db, env } = setup();
  for (let i = 101; i <= 105; i++) progressRow(db, USERS.notary, `tx_notary-b1-${i}`, 'incorrect', 100 + i);
  for (let i = 101; i <= 105; i++) progressRow(db, USERS.notary, `ca_cdl-b1-${i}`, 'incorrect', 300 + i);
  const res = await call(env, 'POST', '/exam/start', { token: TOKENS.notary, body: { mode: 'toughest45' } });
  assert.equal(res.status, 200, 'Weak Spots must actually start (otherwise this test proves nothing)');
  assert.ok(res.json.questions.length > 0);
  assert.ok(!res.text.includes('ca_cdl'), 'Weak Spots must not include another track\'s questions');
});

test('/exam/history: only the caller\'s own attempts', async () => {
  const { env } = setup();
  const a = await call(env, 'POST', '/exam/start', { token: TOKENS.full, body: {} });
  await call(env, 'POST', '/exam/submit', { token: TOKENS.full, body: { attemptId: a.json.attemptId } });
  const own = await call(env, 'GET', '/exam/history', { token: TOKENS.full });
  assert.ok(own.text.includes(a.json.attemptId), 'the owner does see it (otherwise this test proves nothing)');
  const res = await call(env, 'GET', '/exam/history', { token: TOKENS.notary });
  assert.equal(res.status, 200);
  assert.ok(!res.text.includes(a.json.attemptId), 'another user\'s attempt must not be listed');
});

test('a revoked or expired access code logs the account out of every question and exam endpoint', async () => {
  const { env } = setup();
  for (const token of [TOKENS.revoked, TOKENS.expired]) {
    for (const [method, path, body] of [
      ['GET', '/questions/next'], ['POST', '/answer', { questionId: 'ca_cdl-b1-101', choice: 'A' }], ['GET', '/progress'],
      ['POST', '/exam/start', {}], ['GET', '/exam/current'], ['GET', '/exam/history'],
    ]) {
      const res = await call(env, method, path, { token, body });
      assert.equal(res.status, 401, `${method} ${path} with ${token}`);
      assertNoPaidMarkers(assert, res.text, `${method} ${path} with ${token}`);
    }
  }
});
