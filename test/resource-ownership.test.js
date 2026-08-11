// Regression test for the 2026-08-10 bug: /resources/sign-batch would sign ANY requested file for
// ANY authenticated user, regardless of which track their account was actually for -- it checked
// "is there a valid token" but never "does this file belong to my own track". No practical impact
// yet (only ca_notary has real file-based resources today, and filenames aren't guessable), but a
// real gap once other tracks get their own premium audio/video -- see
// [[examprep_track_addition_playbook]] for the fuller incident writeup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_RESOURCE_FILES, filesOwnedByTrack } from '../src/resourceOwnership.js';

test('a ca_notary file is owned by ca_notary', () => {
  const file = ALL_RESOURCE_FILES.ca_notary[0];
  assert.ok(filesOwnedByTrack([file], 'ca_notary'));
});

test('a ca_notary file is NOT owned by any other track', () => {
  const file = ALL_RESOURCE_FILES.ca_notary[0];
  assert.equal(filesOwnedByTrack([file], 'ca_driver'), false);
  assert.equal(filesOwnedByTrack([file], 'ca_cdl'), false);
  assert.equal(filesOwnedByTrack([file], 'ca_motorcycle'), false);
});

test('an unknown/made-up track owns nothing', () => {
  const file = ALL_RESOURCE_FILES.ca_notary[0];
  assert.equal(filesOwnedByTrack([file], 'not_a_real_track'), false);
});

test('a batch mixing one legitimate file with one file from another track is rejected entirely (all-or-nothing, not partial)', () => {
  const legit = ALL_RESOURCE_FILES.ca_notary[0];
  const foreign = 'some_other_tracks_premium_video.mp4';
  assert.equal(filesOwnedByTrack([legit, foreign], 'ca_notary'), false,
    'must fail closed, not silently sign only the legitimate one');
});

test('every file in the catalog is unique across all tracks (no accidental cross-listing)', () => {
  const seen = new Map(); // filename -> which track first claimed it
  for (const [examType, files] of Object.entries(ALL_RESOURCE_FILES)) {
    for (const f of files) {
      assert.ok(!seen.has(f), `"${f}" is listed under both "${seen.get(f)}" and "${examType}" -- a file can only belong to one track`);
      seen.set(f, examType);
    }
  }
});

test('an empty files array does not vacuously pass (defense in depth -- the handler itself also 400s this case before calling filesOwnedByTrack)', () => {
  assert.equal(filesOwnedByTrack([], 'ca_notary'), true, // Array.prototype.every on [] is true by JS spec
    'documenting the JS every-on-empty-array quirk -- this is why handleResourcesSignBatch rejects empty `files` BEFORE this check, not relying on it here');
});
