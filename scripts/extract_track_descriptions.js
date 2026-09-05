// Second half of the app.js data migration (see extract_track_content.js): lifts the per-track
// `description` prose out of HUB_EXAMS_CONTENT into track_content.description. At ~917 B/track it
// was the single largest per-track cost in the bundle -- shipped to every visitor on every page
// load, but read in only two places, each for ONE track at a time.
//
// HUB_EXAMS_CONTENT is an ARRAY of {examType, ...} (unlike the two keyed objects the sibling script
// handles), so this brace-matches the array literal instead.
//
// Usage: node scripts/extract_track_descriptions.js <path-to-app.js> <out.sql>

const fs = require('fs');
const vm = require('vm');

function extractArrayLiteral(src, declName) {
  const start = src.indexOf('var ' + declName + ' =');
  if (start === -1) throw new Error('declaration not found: ' + declName);
  const open = src.indexOf('[', start);
  let depth = 0, i = open, inStr = null, lc = false, bc = false;
  for (; i < src.length; i++) {
    const c = src[i], next = src[i + 1];
    if (lc) { if (c === '\n') lc = false; continue; }
    if (bc) { if (c === '*' && next === '/') { bc = false; i++; } continue; }
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && next === '/') { lc = true; i++; continue; }
    if (c === '/' && next === '*') { bc = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  const sandbox = {};
  vm.runInNewContext('out = ' + src.slice(open, i), sandbox);
  return sandbox.out;
}

const [, , appPath, outPath] = process.argv;
if (!appPath || !outPath) {
  console.error('usage: node extract_track_descriptions.js <app.js> <out.sql>');
  process.exit(2);
}

const content = extractArrayLiteral(fs.readFileSync(appPath, 'utf8'), 'HUB_EXAMS_CONTENT');
const sqlStr = (v) => (v === undefined || v === null ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'");
const now = Math.floor(Date.now() / 1000);

const withDesc = content.filter((c) => c.examType && c.description);
const lines = withDesc.map((c) =>
  // UPSERT: every track already has a track_content row from the first migration, but a track added
  // between the two runs (or one that only ever had a description) must not be silently dropped.
  'INSERT INTO track_content (exam_type, description, updated_at) VALUES (' +
  [sqlStr(c.examType), sqlStr(c.description), now].join(', ') +
  ') ON CONFLICT(exam_type) DO UPDATE SET description = excluded.description, updated_at = excluded.updated_at;'
);

fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log('entries in HUB_EXAMS_CONTENT:', content.length);
console.log('with a description:         ', withDesc.length);
console.log('total description bytes:    ', (withDesc.reduce((a, c) => a + c.description.length, 0) / 1024).toFixed(0) + ' KB');
console.log('wrote', outPath, '(' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB)');
