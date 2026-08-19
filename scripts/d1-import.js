#!/usr/bin/env node
// Bulk-load a .sql file (or a directory of chunk-*.sql files) straight into D1 via
// Cloudflare's REST API -- no wrangler required, so this works fine on this machine's
// win32 arm64 setup where `wrangler d1 execute` cannot run locally (see root CLAUDE.md).
// Replaces the manual "paste each chunk-NN.sql into the D1 Console" step.
//
// Usage:
//   node scripts/d1-import.js <file-or-directory> [--db=<database_id>]
//
// Required env vars:
//   CLOUDFLARE_API_TOKEN     -- API token with "D1 Edit" permission for the account
//   CLOUDFLARE_ACCOUNT_ID    -- Account ID (Cloudflare dashboard right sidebar)
// Optional:
//   CLOUDFLARE_D1_DATABASE_ID -- defaults to this repo's `examprep` DB (see wrangler.jsonc)
//
// If given a directory, every *.sql file in it is imported in filename-sorted order
// (so chunk-00-pricing.sql runs before chunk-01.sql, etc.), stopping on the first failure
// so you can fix and resume from that file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DATABASE_ID = '9dce57bc-02c9-41cb-8d56-3f5a3dd9347b'; // `examprep` DB, from wrangler.jsonc

function parseArgs(argv) {
  const positional = [];
  let databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || DEFAULT_DATABASE_ID;
  for (const arg of argv) {
    if (arg.startsWith('--db=')) databaseId = arg.slice('--db='.length);
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    console.error('Usage: node scripts/d1-import.js <file-or-directory> [--db=<database_id>]');
    process.exit(1);
  }
  return { target: positional[0], databaseId };
}

function resolveSqlFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return fs.readdirSync(target)
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .sort()
      .map((f) => path.join(target, f));
  }
  return [target];
}

async function cfFetch(accountId, databaseId, token, body) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/import`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Cloudflare API error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importFile(filePath, accountId, databaseId, token) {
  const sql = fs.readFileSync(filePath);
  const etag = crypto.createHash('md5').update(sql).digest('hex');

  console.log(`\n[${path.basename(filePath)}] init (etag ${etag})`);
  const init = await cfFetch(accountId, databaseId, token, { action: 'init', etag });

  console.log(`[${path.basename(filePath)}] uploading (${sql.length} bytes)`);
  const uploadRes = await fetch(init.upload_url, { method: 'PUT', body: sql });
  if (!uploadRes.ok) {
    throw new Error(`Upload to R2 failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  console.log(`[${path.basename(filePath)}] starting ingestion`);
  let result = await cfFetch(accountId, databaseId, token, {
    action: 'ingest',
    etag,
    filename: init.filename,
  });

  let bookmark = result.at_bookmark;
  let attempts = 0;
  while (result.status !== 'complete' && attempts < 120) {
    await sleep(1500);
    result = await cfFetch(accountId, databaseId, token, {
      action: 'poll',
      current_bookmark: bookmark,
    });
    bookmark = result.at_bookmark || bookmark;
    if (result.messages && result.messages.length) {
      for (const m of result.messages) console.log(`[${path.basename(filePath)}] ${m}`);
    }
    if (result.status === 'error' || result.error) {
      throw new Error(`Ingestion failed: ${JSON.stringify(result)}`);
    }
    attempts++;
  }

  if (result.status !== 'complete') {
    throw new Error('Timed out waiting for ingestion to complete (3 min)');
  }

  const stats = result.result || {};
  console.log(
    `[${path.basename(filePath)}] done -- ${stats.num_queries ?? '?'} queries, ` +
      `${stats.meta?.rows_written ?? '?'} rows written, ${stats.meta?.duration ?? '?'}ms`
  );
}

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars first.');
    process.exit(1);
  }

  const { target, databaseId } = parseArgs(process.argv.slice(2));
  const files = resolveSqlFiles(target);
  if (!files.length) {
    console.error(`No .sql files found at ${target}`);
    process.exit(1);
  }

  console.log(`Importing ${files.length} file(s) into D1 database ${databaseId}`);
  for (const file of files) {
    await importFile(file, accountId, databaseId, token);
  }
  console.log('\nAll files imported successfully.');
}

main().catch((err) => {
  console.error('\nImport failed:', err.message);
  process.exit(1);
});
