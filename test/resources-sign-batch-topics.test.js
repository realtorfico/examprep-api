// Regression test for the 2026-09-15 daily code review's HIGH finding: /resources/sign-batch signed
// the WHOLE track's media files for an à la carte (owned_topics_json) account, so a one-topic buyer
// could pull working signed URLs for every topic's audio/video out of the response. Now:
// - à la carte: only free files and files tagged with an owned topic get a URL; unowned ones are
//   skipped (not 404'd, so an older cached client sending the full list still works).
// - full-track owner (owned_topics_json NULL): unchanged, every requested file of their track is signed.
// - a file from another track still fails the whole batch (unchanged).
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleResourcesSignBatch } from '../src/index.js';

const OWNED = 'Air Brakes, Combination Vehicles & Doubles/Triples';
const UNOWNED = 'Passenger, School Bus, Tank & HazMat Endorsements';

function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE resources (id TEXT PRIMARY KEY, exam_type TEXT, topic TEXT, free INTEGER, file TEXT);`);
  const insert = db.prepare('INSERT INTO resources VALUES (?, ?, ?, ?, ?)');
  insert.run('1', 'ca_cdl', OWNED, 0, 'owned.m4a');
  insert.run('2', 'ca_cdl', UNOWNED, 0, 'unowned.m4a');
  insert.run('3', 'ca_cdl', 'General Reference', 0, 'general.m4a');
  insert.run('4', 'ca_cdl', UNOWNED, 1, 'free-unowned.m4a');
  insert.run('5', 'ca_notary', 'Fees', 0, 'other-track.m4a');
  return {
    MEDIA_SIGNING_SECRET: 'test-secret',
    DB: {
      prepare(sql) {
        const stmt = db.prepare(sql);
        const bound = (args) => ({ all: async () => ({ results: stmt.all(...args) }), first: async () => stmt.get(...args) ?? null });
        return { ...bound([]), bind: (...args) => bound(args) };
      },
    },
  };
}

function req(files) {
  return new Request('https://api.example.com/resources/sign-batch', {
    method: 'POST', body: JSON.stringify({ files }), headers: { 'content-type': 'application/json' },
  });
}

const ALL_CA_CDL = ['owned.m4a', 'unowned.m4a', 'general.m4a', 'free-unowned.m4a'];

test('à la carte account only gets signed URLs for owned-topic and free files', async () => {
  const user = { exam_type: 'ca_cdl', owned_topics_json: JSON.stringify([OWNED]) };
  const res = await handleResourcesSignBatch(user, req(ALL_CA_CDL), makeEnv());
  assert.equal(res.status, 200);
  const { urls } = await res.json();
  assert.deepEqual(Object.keys(urls).sort(), ['free-unowned.m4a', 'owned.m4a']);
  assert.match(urls['owned.m4a'], /^\/media\/owned\.m4a\?exp=\d+&sig=/);
});

test('full-track account still gets every requested file of its track signed', async () => {
  const user = { exam_type: 'ca_cdl', owned_topics_json: null };
  const res = await handleResourcesSignBatch(user, req(ALL_CA_CDL), makeEnv());
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys((await res.json()).urls).sort(), [...ALL_CA_CDL].sort());
});

test('a file from another track still fails the whole batch, for either account type', async () => {
  for (const owned of [null, JSON.stringify([OWNED])]) {
    const user = { exam_type: 'ca_cdl', owned_topics_json: owned };
    const res = await handleResourcesSignBatch(user, req(['owned.m4a', 'other-track.m4a']), makeEnv());
    assert.equal(res.status, 404);
  }
});
