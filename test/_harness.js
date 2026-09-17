// Shared harness for tests that go through the REAL router (the Worker's default export), so auth,
// routing, and handlers are all exercised together -- a route that's missing, unauthenticated when
// it shouldn't be, or unscoped fails here the same way it would in production.
//
// The database is built from the repo's real schema.sql (not a hand-copied subset), so a schema
// change can't silently drift away from what these tests run against. Not a *.test.js file, so
// `node --test test/*.test.js` doesn't try to run it on its own.

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { _resetTrackRegistryCacheForTests, _resetPublicSetCacheForTests, _resetAccessDenialLimitMemoForTests } from '../src/index.js';

export function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return db;
}

// Minimal D1 facade over node:sqlite -- the subset of the D1 API the Worker actually uses.
export function makeD1(db) {
  function prepare(sql) {
    const stmt = db.prepare(sql);
    const bound = (args) => ({
      first: async () => stmt.get(...args) ?? null,
      all: async () => ({ results: stmt.all(...args) }),
      run: async () => { const r = stmt.run(...args); return { meta: { changes: r.changes } }; },
      _runSync: () => stmt.run(...args),
    });
    return { ...bound([]), bind: (...args) => bound(args) };
  }
  return {
    prepare,
    async batch(statements) { return statements.map((s) => s._runSync()); },
  };
}

export function makeEnv(db) {
  _resetTrackRegistryCacheForTests();
  _resetPublicSetCacheForTests();
  _resetAccessDenialLimitMemoForTests();
  return { DB: makeD1(db), MEDIA_SIGNING_SECRET: 'test-media-secret' };
}

// Calls the real router. Returns { status, json, text } -- text is always the raw body, so a test can
// assert a secret marker never appears anywhere in a response, not just in the fields it expects.
export async function call(env, method, path, { token, body, headers: extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await worker.fetch(new Request('https://api.example.com' + path, init), env);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* non-JSON body */ }
  return { status: res.status, json, text };
}

export async function mcp(env, toolName, args, query = '') {
  const res = await call(env, 'POST', '/mcp' + query, {
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } },
  });
  return { ...res, result: res.json && res.json.result };
}
