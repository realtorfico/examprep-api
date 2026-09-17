// SECURITY: paid table and flashcard content must only reach a logged-in buyer of that track (and,
// for an à la carte buyer, only the topics they bought). Written 2026-09-16 after an audit found
// the public /resources/catalog returned every paid table's rows and every paid deck's cards to
// anyone, on every track -- the site's 🔒 lock was display-only.
//
// Intended shape (these tests define it):
// - GET /resources/catalog (public, cached): metadata for every resource, including a stable `id`,
//   but table/flashcards CONTENT only for free resources.
// - GET /resources/content (login required): { items: { [resourceId]: { table } | { flashcards } | { url } } }
//   for the caller's own track -- every table/deck/link for a full-track buyer; free + owned-topic
//   ones for an à la carte buyer. A paid link resource's url is withheld from the public catalog too.
//   (Media files are NOT here -- they go through signed URLs, see the /media tests below.)
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeEnv, call } from './_harness.js';
import { seedPaidContent, assertNoPaidMarkers, TOKENS } from './_paid-content-fixture.js';
import { signMediaUrl } from '../src/lib/mediaSign.js';

function setup() {
  const db = makeDb();
  seedPaidContent(db);
  return { db, env: makeEnv(db) };
}

// ---- Public catalog -----------------------------------------------------------------------------

test('/resources/catalog (one track): no paid table/flashcard content, free content still included', async () => {
  const { env } = setup();
  const res = await call(env, 'GET', '/resources/catalog?examType=ca_cdl');
  assert.equal(res.status, 200);
  assertNoPaidMarkers(assert, res.text, 'catalog ca_cdl');
  assert.ok(res.text.includes('PUBLIC-TABLE ca_cdl free'), 'free table content stays public');
  assert.ok(res.text.includes('PUBLIC-CARD ca_cdl free'), 'free deck content stays public');
  assert.equal(res.json.resources.ca_cdl.length, 14, 'every resource is still listed (shown locked, not hidden)');
  assert.ok(res.text.includes('PUBLIC-URL-free.pdf'), 'a free link resource keeps its url');
  const paidAudio = res.json.resources.ca_cdl.find((r) => r.id === 'ca_cdl:paid-audio-owned');
  assert.equal(paidAudio.file, 'paid-owned.m4a', 'media filenames stay listed -- a filename alone cannot fetch the file (signed URLs only)');
});

test('/resources/catalog (whole catalog): no paid table/flashcard content for any track', async () => {
  const { env } = setup();
  const res = await call(env, 'GET', '/resources/catalog');
  assert.equal(res.status, 200);
  assertNoPaidMarkers(assert, res.text, 'full catalog');
});

test('/resources/catalog: every item carries its stable resource id, so a logged-in buyer\'s content can be matched to it', async () => {
  const { env } = setup();
  const res = await call(env, 'GET', '/resources/catalog?examType=ca_cdl');
  const ids = res.json.resources.ca_cdl.map((r) => r.id).sort();
  assert.deepEqual(ids, ['ca_cdl:free-audio', 'ca_cdl:free-deck', 'ca_cdl:free-pdf', 'ca_cdl:free-table', 'ca_cdl:paid-audio-owned',
    'ca_cdl:paid-audio-unowned', 'ca_cdl:paid-deck-owned', 'ca_cdl:paid-deck-unowned', 'ca_cdl:paid-general-audio', 'ca_cdl:paid-general-table',
    'ca_cdl:paid-pdf-owned', 'ca_cdl:paid-pdf-unowned', 'ca_cdl:paid-table-owned', 'ca_cdl:paid-table-unowned']);
});

test('/resources/catalog?counts=1: card counts still include paid decks (pre-purchase stat tiles)', async () => {
  const { env } = setup();
  const res = await call(env, 'GET', '/resources/catalog?counts=1');
  assert.deepEqual({ tables: res.json.counts.ca_cdl.tables, decks: res.json.counts.ca_cdl.decks, cards: res.json.counts.ca_cdl.cards },
    { tables: 4, decks: 3, cards: 3 }); // 4 tables: owned, unowned, free, General Reference
});

// ---- Authenticated content ----------------------------------------------------------------------

test('/resources/content: requires a valid login (no token, fake token, revoked code, expired code)', async () => {
  const { env } = setup();
  for (const token of [undefined, 'not-a-real-token', TOKENS.revoked, TOKENS.expired]) {
    const res = await call(env, 'GET', '/resources/content', { token });
    assert.equal(res.status, 401);
    assertNoPaidMarkers(assert, res.text, '/resources/content without valid login');
  }
});

test('/resources/content: a full-track buyer gets every table and deck on their own track, nothing from other tracks', async () => {
  const { env } = setup();
  const res = await call(env, 'GET', '/resources/content', { token: TOKENS.full });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json.items).sort(), ['ca_cdl:free-deck', 'ca_cdl:free-pdf', 'ca_cdl:free-table', 'ca_cdl:paid-deck-owned',
    'ca_cdl:paid-deck-unowned', 'ca_cdl:paid-general-table', 'ca_cdl:paid-pdf-owned', 'ca_cdl:paid-pdf-unowned', 'ca_cdl:paid-table-owned',
    'ca_cdl:paid-table-unowned']);
  assert.equal(res.json.items['ca_cdl:paid-pdf-unowned'].url, 'https://example.com/PAID-URL-SECRET-unowned.pdf');
  assert.equal(res.json.items['ca_cdl:paid-table-owned'].table.rows[0][0], 'PAID-TABLE-SECRET ca_cdl owned');
  assert.equal(res.json.items['ca_cdl:paid-deck-unowned'].flashcards[0].front, 'PAID-CARD-SECRET ca_cdl unowned');
  assert.ok(!res.text.includes('tx_notary'), 'no other track\'s content');
});

test('/resources/content: an à la carte buyer gets free + owned-topic + General Reference content only', async () => {
  const { env } = setup();
  const res = await call(env, 'GET', '/resources/content', { token: TOKENS.topic });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json.items).sort(), ['ca_cdl:free-deck', 'ca_cdl:free-pdf', 'ca_cdl:free-table', 'ca_cdl:paid-deck-owned',
    'ca_cdl:paid-general-table', 'ca_cdl:paid-pdf-owned', 'ca_cdl:paid-table-owned']);
  assert.ok(!res.text.includes('unowned'), 'no un-owned topic content');
});

test('/resources/content: a buyer of a different track gets only their own track\'s content', async () => {
  const { env } = setup();
  const res = await call(env, 'GET', '/resources/content', { token: TOKENS.notary });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json.items), ['tx_notary:paid-table']);
  assert.ok(!res.text.includes('ca_cdl'));
});

// ---- Signed media URLs (regression guards -- verified correct live in the 2026-09-16 audit) ------

// Fake R2 binding: every seeded media file "exists", so a 403 can only come from the signature check.
function withMedia(env) {
  const files = new Set(['paid-owned.m4a', 'paid-unowned.m4a', 'free.m4a', 'notary-paid.m4a', 'paid-general.m4a']);
  env.MEDIA = {
    head: async (key) => (files.has(key) ? { size: 10 } : null),
    get: async (key) => (files.has(key) ? { body: 'PAID-MEDIA-BYTES', writeHttpMetadata() {}, httpEtag: '"etag"' } : null),
  };
  return env;
}

test('/media: a paid file cannot be fetched without a valid signature (none, forged, expired, or one signed for a different file)', async () => {
  const { env } = setup();
  withMedia(env);
  const expired = await signMediaUrl(env, 'paid-owned.m4a', -60);
  const otherFile = await signMediaUrl(env, 'free.m4a', 3600);
  for (const path of [
    '/media/paid-owned.m4a',
    '/media/paid-owned.m4a?exp=9999999999&sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    `/media/paid-owned.m4a?exp=${expired.exp}&sig=${expired.sig}`,
    `/media/paid-owned.m4a?exp=${otherFile.exp}&sig=${otherFile.sig}`,
  ]) {
    const res = await call(env, 'GET', path);
    assert.equal(res.status, 403, path);
    assert.ok(!res.text.includes('PAID-MEDIA-BYTES'), path);
  }
});

test('/media: a URL signed for a buyer works (proves the 403s above come from the signature check, not a broken fixture)', async () => {
  const { env } = setup();
  withMedia(env);
  const signed = await call(env, 'POST', '/resources/sign-batch', { token: TOKENS.full, body: { files: ['paid-owned.m4a'] } });
  assert.equal(signed.status, 200);
  const res = await call(env, 'GET', signed.json.urls['paid-owned.m4a']);
  assert.equal(res.status, 200);
  assert.equal(res.text, 'PAID-MEDIA-BYTES');
});

test('/resources/sign-batch: requires a valid login, never signs another track\'s file, and never signs an un-owned topic\'s file for an à la carte buyer', async () => {
  const { env } = setup();
  for (const token of [undefined, 'not-a-real-token', TOKENS.revoked, TOKENS.expired]) {
    const res = await call(env, 'POST', '/resources/sign-batch', { token, body: { files: ['paid-owned.m4a'] } });
    assert.equal(res.status, 401, `token=${token}`);
  }
  const foreign = await call(env, 'POST', '/resources/sign-batch', { token: TOKENS.notary, body: { files: ['paid-owned.m4a'] } });
  assert.equal(foreign.status, 404);
  assert.ok(!foreign.text.includes('sig='));
  const topic = await call(env, 'POST', '/resources/sign-batch', { token: TOKENS.topic, body: { files: ['paid-owned.m4a', 'paid-unowned.m4a', 'free.m4a', 'paid-general.m4a'] } });
  assert.equal(topic.status, 200);
  assert.deepEqual(Object.keys(topic.json.urls).sort(), ['free.m4a', 'paid-general.m4a', 'paid-owned.m4a'], 'owned topic, free, and General Reference -- never an un-owned topic');
});

test('/resources/free: only signs files marked free -- never a paid file, on any track', async () => {
  const { env } = setup();
  for (const examType of ['ca_cdl', 'tx_notary', 'zz_cdl', 'no_such_track']) {
    const res = await call(env, 'GET', '/resources/free?examType=' + examType);
    assert.equal(res.status, 200);
    const files = Object.keys(res.json.urls);
    assert.deepEqual(files, examType === 'ca_cdl' ? ['free.m4a'] : [], examType);
  }
});
