// Pure authorization check, testable without spinning up the Workers runtime or D1 -- see
// test/resource-ownership.test.js. The actual catalog of which files belong to which track now
// lives in D1's `resources` table (file IS NOT NULL rows) -- the caller (handleResourcesSignBatch
// in index.js) queries that fresh per request and passes the owned-files list in, keeping this
// function a plain, synchronously-testable set-membership check with no data-source coupling.
//
// Deliberately all-or-nothing (not "sign whichever ones are valid, drop the rest") so a request
// mixing one legitimate file with one file from a different track fails loudly instead of silently
// partially succeeding.
export function filesOwnedByTrack(files, ownedFiles) {
  const owned = new Set(ownedFiles || []);
  return files.every((f) => owned.has(f));
}
