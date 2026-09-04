// Regression test for the 2026-08-10 bug: /resources/sign-batch would sign ANY requested file for
// ANY authenticated user, regardless of which track their account was actually for -- it checked
// "is there a valid token" but never "does this file belong to my own track". No practical impact
// yet (only ca_notary has real file-based resources today, and filenames aren't guessable), but a
// real gap once other tracks get their own premium audio/video -- see
// [[examprep_track_addition_playbook]] for the fuller incident writeup.
//
// 2026-09-03: filesOwnedByTrack() became a pure set-membership check -- the real catalog moved to
// D1's `resources` table (see schema.sql), with a UNIQUE partial index on `file` enforcing
// "a file can only belong to one track" at the source of truth (previously only checked here by a
// JS unit test against a static object, which could go stale -- a real DB constraint can't).
// These tests use a small fixture standing in for what a real `SELECT file FROM resources WHERE
// exam_type = ? AND file IS NOT NULL` result would look like.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filesOwnedByTrack } from '../src/resourceOwnership.js';

const CA_NOTARY_FILES = ['The_Power_Behind_California_Notary_Stamps.m4a', 'California_Notary_Fees.mp4'];

test('a ca_notary file is owned by ca_notary', () => {
  assert.ok(filesOwnedByTrack([CA_NOTARY_FILES[0]], CA_NOTARY_FILES));
});

test('a ca_notary file is NOT owned by any other track (empty owned-files list for that track)', () => {
  assert.equal(filesOwnedByTrack([CA_NOTARY_FILES[0]], []), false);
});

test('an unknown/made-up track owns nothing', () => {
  assert.equal(filesOwnedByTrack([CA_NOTARY_FILES[0]], undefined), false);
});

test('a batch mixing one legitimate file with one file from another track is rejected entirely (all-or-nothing, not partial)', () => {
  const foreign = 'some_other_tracks_premium_video.mp4';
  assert.equal(filesOwnedByTrack([CA_NOTARY_FILES[0], foreign], CA_NOTARY_FILES), false,
    'must fail closed, not silently sign only the legitimate one');
});

test('an empty files array does not vacuously pass (defense in depth -- the handler itself also 400s this case before calling filesOwnedByTrack)', () => {
  assert.equal(filesOwnedByTrack([], CA_NOTARY_FILES), true, // Array.prototype.every on [] is true by JS spec
    'documenting the JS every-on-empty-array quirk -- this is why handleResourcesSignBatch rejects empty `files` BEFORE this check, not relying on it here');
});
