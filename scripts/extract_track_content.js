// One-shot migration helper: lifts TRACK_COMPLIANCE and ADDITIONAL_INFO_LINKS out of the site's
// app.js and emits SQL for the `track_content` table, so those ~726KB of per-track data stop
// shipping in the JS bundle on every page load (see project_frontend_payload_optimization memory).
//
// Same idea as the 2026-09-03 RESOURCES -> D1 migration: both blobs are pure `[examType]` lookups,
// so nothing needs them all at once. Extracts by brace-matching the real declaration text and
// evaluating it in a vm sandbox -- no DOM needed, and no risk of a regex mis-parsing nested
// objects/apostrophes inside the prose.
//
// Usage: node scripts/extract_track_content.js <path-to-app.js> <out.sql>

const fs = require('fs');
const vm = require('vm');

function extractObjectLiteral(src, declName) {
  const start = src.indexOf('var ' + declName + ' =');
  if (start === -1) throw new Error('declaration not found: ' + declName);
  const open = src.indexOf('{', start);
  if (open === -1) throw new Error('no opening brace for ' + declName);

  let depth = 0, i = open, inStr = null, inLineComment = false, inBlockComment = false;
  for (; i < src.length; i++) {
    const c = src[i], prev = src[i - 1], next = src[i + 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const literal = src.slice(open, i);
  const sandbox = {};
  vm.runInNewContext('out = ' + literal, sandbox);
  return sandbox.out;
}

const [, , appPath, outPath] = process.argv;
if (!appPath || !outPath) {
  console.error('usage: node extract_track_content.js <app.js> <out.sql>');
  process.exit(2);
}

const src = fs.readFileSync(appPath, 'utf8');
const compliance = extractObjectLiteral(src, 'TRACK_COMPLIANCE');
const infoLinks = extractObjectLiteral(src, 'ADDITIONAL_INFO_LINKS');

const examTypes = [...new Set([...Object.keys(compliance), ...Object.keys(infoLinks)])].sort();
const sqlStr = (v) => (v === undefined || v === null ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'");
const now = Math.floor(Date.now() / 1000);

const lines = ['DELETE FROM track_content;'];
for (const et of examTypes) {
  const c = compliance[et] || {};
  const links = infoLinks[et];
  lines.push(
    'INSERT INTO track_content (exam_type, org_line, footer_requirement, terms_paragraph2, exam_intro_disclaimer, pass_score_note, info_links_json, updated_at) VALUES (' +
      [sqlStr(et), sqlStr(c.orgLine), sqlStr(c.footerRequirement), sqlStr(c.termsParagraph2),
       sqlStr(c.examIntroDisclaimer), sqlStr(c.passScoreNote),
       links && links.length ? sqlStr(JSON.stringify(links)) : 'NULL', now].join(', ') + ');'
  );
}
fs.writeFileSync(outPath, lines.join('\n') + '\n');

console.log('exam types:            ', examTypes.length);
console.log('  with compliance data:', Object.keys(compliance).length);
console.log('  with info links:     ', Object.keys(infoLinks).length);
console.log('compliance field coverage:');
for (const f of ['orgLine', 'footerRequirement', 'termsParagraph2', 'examIntroDisclaimer', 'passScoreNote']) {
  console.log('  ' + f.padEnd(22) + Object.values(compliance).filter((c) => c && c[f] != null).length);
}
console.log('wrote', outPath, '(' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB)');
