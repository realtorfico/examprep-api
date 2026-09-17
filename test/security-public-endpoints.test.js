// SECURITY: nothing reachable WITHOUT a login may reveal paid questions or paid resource content.
// Written 2026-09-16 after an audit found:
// - the public MCP endpoint's grade_practice_answer returned the correct answer + explanation for
//   ANY question id (ids are guessable, e.g. "tx_cdl-b1-001"), and get_sample_question's topic
//   filter reached questions far below the free-sample tier;
// - /sample served questions for tracks pulled from sale (inactive);
// - /resources/catalog returned the full content of paid tables and flashcards to anyone.
//
// Public set (decided 2026-09-16): each ACTIVE track's first N questions by (weight DESC, id ASC), where
// N = min(30, 10% of the track's bank). The free sample, question of the day and MCP tools may show those,
// and nothing else -- so no amount of repeat calling can collect more than N questions per track.
//
// The sweep test calls EVERY unauthenticated GET route found in the router source (not a hand-kept
// list), so a new public route that leaks paid content fails here without anyone having to
// remember to add a test for it.
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDb, makeEnv, call, mcp } from './_harness.js';
import { seedPaidContent, seedActivity, assertNoPaidMarkers, T_OWNED, T_UNOWNED, PAID_MARKERS, PUBLIC_SET } from './_paid-content-fixture.js';

function setup() {
  const db = makeDb();
  seedPaidContent(db);
  return { db, env: makeEnv(db) };
}

const EXAM_TYPES = ['ca_cdl', 'tx_notary', 'zz_cdl'];

// ---- MCP (public AI-assistant tool endpoint) ----------------------------------------------------

test('MCP grade_practice_answer: never reveals the answer or explanation for a question outside the public free-sample pool', async () => {
  const { db, env } = setup();
  // Highest-weight paid questions first (the ones just past the public-set cap), then a spread of the rest.
  const paidIds = db.prepare("SELECT id FROM questions WHERE question LIKE 'PAID-QUESTION%' ORDER BY weight DESC, id LIMIT 60").all().map((r) => r.id);
  assert.ok(paidIds.length > 0);
  for (const questionId of paidIds) {
    const res = await mcp(env, 'grade_practice_answer', { questionId, response: 'B' });
    assertNoPaidMarkers(assert, res.text, `grade_practice_answer ${questionId}`);
    assert.ok(!(res.result && res.result.structuredContent && res.result.structuredContent.correctChoice),
      `must not return correctChoice for ${questionId}`);
  }
});

test('MCP grade_practice_answer: still grades a question from the public free-sample pool', async () => {
  const { env } = setup();
  const res = await mcp(env, 'grade_practice_answer', { questionId: 'ca_cdl-b1-001', response: 'A' });
  assert.equal(res.result.isError, false);
  assert.ok(res.result.structuredContent.explanation.includes('PUBLIC-EXPLANATION'));
});

test('MCP get_sample_question: never returns a question outside the public pool, with or without a topic filter, and nothing for an inactive track', async () => {
  const { env } = setup();
  for (const examType of EXAM_TYPES) {
    for (const topic of [undefined, T_OWNED, T_UNOWNED, 'Notary Duties']) {
      for (let i = 0; i < 12; i++) {
        const res = await mcp(env, 'get_sample_question', topic ? { examType, topic } : { examType });
        assertNoPaidMarkers(assert, res.text, `get_sample_question ${examType} topic=${topic}`);
      }
    }
  }
});

// ---- /sample ------------------------------------------------------------------------------------

test('/sample: only the public tier for an active track, and nothing for a track pulled from sale', async () => {
  const { env } = setup();
  for (let i = 0; i < 10; i++) {
    const res = await call(env, 'GET', '/sample?examType=ca_cdl');
    assert.equal(res.status, 200);
    assertNoPaidMarkers(assert, res.text, '/sample ca_cdl');
  }
  const inactive = await call(env, 'GET', '/sample?examType=zz_cdl');
  assert.equal(inactive.status, 404, 'an inactive track must not serve sample questions');
  assertNoPaidMarkers(assert, inactive.text, '/sample zz_cdl');
});

// ---- Sweep: every unauthenticated GET route ------------------------------------------------------

function publicGetRoutes() {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const router = src.slice(src.indexOf('export default {'));
  const publicPart = router.slice(0, router.indexOf("pathname.startsWith('/console/')"));
  const routes = new Set();
  for (const m of publicPart.matchAll(/pathname === '([^']+)' && method === 'GET'/g)) routes.add(m[1]);
  return [...routes];
}

const SWEEP_EXCLUDED = {};

test('sweep: no unauthenticated GET route returns paid questions or paid resource content for any track', async () => {
  const { db, env } = setup();
  seedActivity(db); // real progress/exam/resource activity, so stats and activity endpoints have something to leak
  const routes = publicGetRoutes();
  assert.ok(routes.length >= 15, `router parse looks wrong, found only ${routes.length} public GET routes`);
  const kindParams = 'kind=' + encodeURIComponent('Commercial Driver (CDL)') + '&slug=cdl&placement=home';
  // Collects every leak before failing, so one run lists all of them instead of stopping at the first.
  const leaks = [];
  for (const route of routes) {
    if (SWEEP_EXCLUDED[route]) continue;
    for (const examType of [...EXAM_TYPES, undefined]) {
      const query = (examType ? 'examType=' + examType + '&' : '') + kindParams;
      const res = await call(env, 'GET', route + '?' + query);
      const found = PAID_MARKERS.filter((m) => res.text.includes(m));
      if (found.length) leaks.push(`GET ${route}${examType ? '?examType=' + examType : ''} -> ${found.join(', ')}`);
    }
  }
  assert.deepEqual(leaks, [], 'unauthenticated routes returned paid content:\n  ' + leaks.join('\n  '));
});

// ---- More MCP guards ----------------------------------------------------------------------------

test('MCP on a category-scoped endpoint (/mcp?kind=cdl) with no examType: only public-pool questions, never an inactive track\'s', async () => {
  const { env } = setup();
  for (let i = 0; i < 15; i++) {
    const res = await mcp(env, 'get_sample_question', {}, '?kind=cdl');
    assert.equal(res.result.isError, false, 'must still return a sample question (otherwise this test proves nothing)');
    assertNoPaidMarkers(assert, res.text, 'get_sample_question via ?kind=cdl');
  }
});

test('MCP list_available_tracks: never lists a track pulled from sale', async () => {
  const { env } = setup();
  const res = await mcp(env, 'list_available_tracks', { kind: 'Commercial Driver (CDL)' });
  assert.ok(res.text.includes('ca_cdl'), 'active track is listed (otherwise this test proves nothing)');
  assert.ok(!res.text.includes('zz_cdl'), 'inactive track must not be listed');
});

test('MCP grade_practice_answer: an inactive track\'s question is never graded, even a top-weight one', async () => {
  const { env } = setup();
  const res = await mcp(env, 'grade_practice_answer', { questionId: 'zz_cdl-b1-001', response: 'A' });
  assertNoPaidMarkers(assert, res.text, 'grade inactive-track question');
});

// ---- Question of the day ------------------------------------------------------------------------

test('/qotd: nothing for a track pulled from sale or an unknown track', async () => {
  const { env } = setup();
  for (const examType of ['zz_cdl', 'no_such_track']) {
    const res = await call(env, 'GET', '/qotd?examType=' + examType);
    assert.equal(res.status, 404, examType);
    assertNoPaidMarkers(assert, res.text, '/qotd ' + examType);
  }
});

// Runs /qotd across a year of simulated days. It used to walk a track's WHOLE bank one question per day
// (ORDER BY id), so over time every paid question -- with its answer -- became public.
test('/qotd: over a year of days, only ever shows questions from the track\'s public set, and still rotates through it', async () => {
  const { env } = setup();
  const realNow = Date.now;
  const leaks = new Set();
  const shown = { ca_cdl: new Set(), tx_notary: new Set() };
  try {
    for (let day = 20000; day < 20365; day++) {
      Date.now = () => day * 86400000 + 1000;
      for (const examType of ['ca_cdl', 'tx_notary']) {
        const res = await call(env, 'GET', '/qotd?examType=' + examType);
        assert.equal(res.status, 200);
        if (PAID_MARKERS.some((m) => res.text.includes(m))) leaks.add(examType + ' day ' + day);
        shown[examType].add(res.json.question);
      }
    }
  } finally {
    Date.now = realNow;
  }
  assert.equal(leaks.size, 0, `/qotd showed paid questions on ${leaks.size} simulated days`);
  assert.equal(shown.ca_cdl.size, PUBLIC_SET.ca_cdl.length, 'rotates through every public-set question over time');
  assert.equal(shown.tx_notary.size, PUBLIC_SET.tx_notary.length);
});

// ---- Free sample repeat-pulling -----------------------------------------------------------------

// /sample used to return 10 random questions from the whole top-weight tier on every call, with answers
// and no limit -- repeat calls collected the entire tier (live: 25 calls got all 43 of tx_cdl's weight-5
// questions). Now it samples 10 from the track's fixed public set, so repeat calls top out at N.
test('/sample: repeated calls collect exactly the track\'s public set (10% of the bank, max 30), never more', async () => {
  const { env } = setup();
  for (const [examType, expected] of Object.entries(PUBLIC_SET)) {
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      const res = await call(env, 'GET', '/sample?examType=' + examType);
      assert.equal(res.status, 200);
      assert.equal(res.json.questions.length, 10, 'still a 10-question sample');
      res.json.questions.forEach((q) => seen.add(q.id));
    }
    assert.deepEqual([...seen].sort(), [...expected].sort(), `${examType}: repeat calls must collect exactly its public set`);
  }
});

test('MCP get_sample_question: repeated calls never go beyond the track\'s public set', async () => {
  const { env } = setup();
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    const res = await mcp(env, 'get_sample_question', { examType: 'tx_notary' });
    assert.equal(res.result.isError, false);
    seen.add(res.result.structuredContent.questionId);
  }
  assert.ok([...seen].every((id) => PUBLIC_SET.tx_notary.includes(id)), 'only public-set questions: ' + [...seen].filter((id) => !PUBLIC_SET.tx_notary.includes(id)).join(', '));
});
