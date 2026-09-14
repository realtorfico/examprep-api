// Regression coverage for the parts of the à la carte topic-purchase pilot that restrict access
// for a PARTIAL (owned_topics_json set) buyer, vs. leaving a FULL-track buyer (owned_topics_json
// NULL -- every existing user, and the default for every non-à-la-carte purchase) completely
// unaffected. See project memory project_ca_cdl_topic_purchase_pilot.
//
// Three real, high-risk surfaces (this is live exam-serving and refund-money logic for every
// track, not just CA CDL):
// 1. GET /prefs now also returns ownedTopics (parsed via the existing ownedTopicsFor helper) --
//    the site needs this on every page that gates content by topic ownership.
// 2. Exam mode AND Weak Spots mode (both simulate the real, complete exam) require full-track
//    access -- checked FIRST in handleExamStart, before the resume-lookup or any question
//    selection, so a partial owner can neither start nor resume either mode.
// 3. The exam-failure refund guarantee (`exam_failure_50pct`) is rejected for a partial-owner's
//    purchase -- its whole premise ("used our full prep material and still failed") doesn't hold
//    for someone who only studied some of the real exam's topics. The always-unconditional 7-day
//    refund is untouched either way.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  handlePrefsGet, handleExamStart, handleRefundClaimSubmit, _resetTrackRegistryCacheForTests,
} from '../src/index.js';

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
    CREATE TABLE exam_attempts (id TEXT PRIMARY KEY, user_id TEXT, exam_type TEXT, question_ids TEXT,
      answers TEXT, duration_sec INTEGER, started_at INTEGER, submitted_at INTEGER, mode TEXT, pass_percent INTEGER);
    CREATE TABLE track_registry (exam_type TEXT PRIMARY KEY, kind TEXT, state_code TEXT, short_name TEXT,
      active INTEGER, is_exam_required INTEGER, exam_question_count INTEGER, exam_duration_sec INTEGER,
      pass_percent INTEGER, min_correct INTEGER, mechanics_note TEXT, updated_at INTEGER);
    CREATE TABLE codes (code TEXT PRIMARY KEY, exam_type TEXT, status TEXT, note TEXT, expires_at INTEGER,
      redeemed_by TEXT, redeemed_at INTEGER, issued_at INTEGER, paid_cents INTEGER, buyer_email TEXT, referral_source TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, exam_type TEXT, token TEXT, owned_topics_json TEXT);
    CREATE TABLE refund_claims (id TEXT PRIMARY KEY, code TEXT, email TEXT, claim_type TEXT, status TEXT,
      exam_date TEXT, confirmation_note TEXT, notes TEXT, refund_cents INTEGER, created_at INTEGER);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
  `);
  db.prepare(`INSERT INTO track_registry VALUES ('ca_cdl', 'CDL', 'CA', 'CA CDL', 1, 1, 4, 3600, 80, 3, NULL, 0)`).run();
  insertQuestion(db, 'q1', 'ca_cdl', 'General Knowledge (CDL Rules, Safe Driving & Cargo)');
  insertQuestion(db, 'q2', 'ca_cdl', 'General Knowledge (CDL Rules, Safe Driving & Cargo)');
  insertQuestion(db, 'q3', 'ca_cdl', 'Air Brakes, Combination Vehicles & Doubles/Triples');
  insertQuestion(db, 'q4', 'ca_cdl', 'Vehicle Inspection Procedures');
  return db;
}

function insertQuestion(db, id, examType, topic) {
  db.prepare('INSERT INTO questions (id, exam_type, topic, weight, question, choice_a, choice_b, choice_c, choice_d, correct_choice) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, examType, topic, 1, 'Q?', 'A', 'B', 'C', 'D', 'A');
}

function req(body) {
  return new Request('https://api.example.com/exam/start', {
    method: 'POST', body: JSON.stringify(body || {}), headers: { 'content-type': 'application/json' },
  });
}

// ---- handlePrefsGet ------------------------------------------------------

test('handlePrefsGet: returns ownedTopics null for a full-access user (every existing user today)', async () => {
  const res = await handlePrefsGet({ theme: 'system', font_scale: 1, exam_type: 'ca_cdl', owned_topics_json: null });
  const body = await res.json();
  assert.equal(body.ownedTopics, null);
  assert.equal(body.examType, 'ca_cdl');
});

test('handlePrefsGet: returns the real owned topics array for an à la carte user', async () => {
  const res = await handlePrefsGet({ theme: 'system', font_scale: 1, exam_type: 'ca_cdl', owned_topics_json: '["General Knowledge (CDL Rules, Safe Driving & Cargo)"]' });
  const body = await res.json();
  assert.deepEqual(body.ownedTopics, ['General Knowledge (CDL Rules, Safe Driving & Cargo)']);
});

// ---- handleExamStart ------------------------------------------------------

test('handleExamStart: a partial (à la carte) owner is rejected before any exam_attempts row is created, standard mode', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl', owned_topics_json: '["General Knowledge (CDL Rules, Safe Driving & Cargo)"]' };

  const res = await handleExamStart(user, req({ mode: 'standard' }), env);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'requires_full_track_access');
  const rowCount = db.prepare('SELECT COUNT(*) AS n FROM exam_attempts').get().n;
  assert.equal(rowCount, 0, 'no attempt should ever have been created for a rejected request');
});

test('handleExamStart: a partial owner is rejected in Weak Spots mode too, not just standard', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl', owned_topics_json: '["Vehicle Inspection Procedures"]' };

  const res = await handleExamStart(user, req({ mode: 'toughest45' }), env);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'requires_full_track_access');
});

test('handleExamStart: a full-track owner (owned_topics_json NULL) is completely unaffected -- a real attempt is created', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl', owned_topics_json: null };

  const res = await handleExamStart(user, req({ mode: 'standard' }), env);
  assert.equal(res.status, 200, 'a full-track owner must not be blocked by the new guard');
  const body = await res.json();
  assert.ok(body.attemptId);
  assert.equal(body.questions.length, 4, 'all 4 questions across every topic are eligible for a full-track owner');
  const rowCount = db.prepare('SELECT COUNT(*) AS n FROM exam_attempts').get().n;
  assert.equal(rowCount, 1);
});

test('handleExamStart: an existing in-progress attempt for a partial owner is also blocked on resume, not just on fresh start', async (t) => {
  // Simulates a user who somehow has an in-progress attempt (e.g. was full-access, then an
  // owned_topics_json value got set) -- the guard must block resuming it too, not just creating a
  // new one, since it runs before findInProgressAttempt is ever reached.
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  db.prepare(`INSERT INTO exam_attempts VALUES ('a1','u1','ca_cdl','["q1","q2","q3","q4"]','{}',3600,?,NULL,'standard',80)`).run(Math.floor(Date.now() / 1000));
  const env = { DB: makeD1(db) };
  const user = { id: 'u1', exam_type: 'ca_cdl', owned_topics_json: '["General Knowledge (CDL Rules, Safe Driving & Cargo)"]' };

  const res = await handleExamStart(user, req({ mode: 'standard' }), env);
  assert.equal(res.status, 403);
});

// ---- handleRefundClaimSubmit ------------------------------------------------------

function refundReq(body) {
  return new Request('https://api.example.com/refunds/claim', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

function seedRefundFixtures(db, { ownedTopicsJson = null } = {}) {
  db.prepare(`INSERT INTO users VALUES ('buyer1', 'ca_cdl', 'tok1', ?)`).run(ownedTopicsJson);
  db.prepare(`INSERT INTO codes VALUES ('CODE1', 'ca_cdl', 'redeemed', 'paypal:ORDER123', NULL, 'buyer1', ?, ?, 3699, 'buyer@example.com', NULL)`)
    .run(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
}

test('handleRefundClaimSubmit: exam-failure claim is rejected for an à la carte (partial-owner) purchase', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  seedRefundFixtures(db, { ownedTopicsJson: '["General Knowledge (CDL Rules, Safe Driving & Cargo)"]' });
  const env = { DB: makeD1(db) };

  const res = await handleRefundClaimSubmit(refundReq({ code: 'CODE1', email: 'buyer@example.com', claimType: 'exam_failure_50pct' }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'not_eligible_ala_carte');
  const claimCount = db.prepare('SELECT COUNT(*) AS n FROM refund_claims').get().n;
  assert.equal(claimCount, 0, 'no claim row should be created for a rejected request');
});

test('handleRefundClaimSubmit: exam-failure claim still works normally for a full-track purchase', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  seedRefundFixtures(db, { ownedTopicsJson: null });
  const env = { DB: makeD1(db) };

  const res = await handleRefundClaimSubmit(refundReq({ code: 'CODE1', email: 'buyer@example.com', claimType: 'exam_failure_50pct' }), env);
  assert.equal(res.status, 200, 'a full-track buyer must not be blocked by the new à la carte check');
});

test('handleRefundClaimSubmit: the unconditional 7-day refund is unaffected by à la carte status either way', async (t) => {
  _resetTrackRegistryCacheForTests();
  const db = makeDb();
  seedRefundFixtures(db, { ownedTopicsJson: '["Vehicle Inspection Procedures"]' });
  const env = { DB: makeD1(db) };

  const res = await handleRefundClaimSubmit(refundReq({ code: 'CODE1', email: 'buyer@example.com', claimType: 'unconditional_7day' }), env);
  assert.equal(res.status, 200, 'the always-unconditional refund type has no exam-performance premise, so à la carte status is irrelevant to it');
});
