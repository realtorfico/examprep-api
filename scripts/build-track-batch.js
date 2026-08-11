#!/usr/bin/env node
// Reusable question-batch pipeline for any track: load generated JSON -> validate -> dedupe
// -> write full SQL -> sanity-check the SQL -> split into D1-Console-sized chunks -> print a
// spot-check sample. Replaces the one-off build_<track>_sql.js / split_*.js / check_*.js /
// spot_check_*.js scripts written per track in temp/.
//
// Usage: node scripts/build-track-batch.js scripts/tracks/<track>.json [batchNumber]
//
// Each track config is a small JSON file (see scripts/tracks/*.json for examples) with:
//   examType      - e.g. "tx_driver" (must match the {state}_{category} convention)
//   questionsDir  - folder containing ONLY this track's generated *.json question-bucket files
//   priceCents    - self-serve price for this track
//   handbookNote  - human-readable source citation, embedded as a SQL comment for provenance
//   outDir        - where to write the .sql / chunks / dropped-report (optional, defaults next to config)
//
// Everything else (id prefix, source tag, dedupe threshold, chunk size, timestamps) is derived
// automatically so a new track only ever needs a new config file, not new code.

const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = ['topic', 'question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'correct_choice', 'explanation', 'weight', 'source_note'];
const CHUNK_SIZE = 40;
const DEDUPE_THRESHOLD = 0.72;
const SPOT_CHECK_SAMPLES = 12;

const STOPWORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'and', 'or', 'but', 'if', 'you', 'your', 'it', 'this', 'that', 'as', 'from', 'which', 'what', 'when', 'where', 'how', 'does', 'do', 'did', 'must', 'may', 'can', 'not', 'no']);
function normWords(s) { return (s.toLowerCase().match(/[a-z0-9']+/g) || []).filter(w => !STOPWORDS.has(w)); }
function jaccard(aWords, bWords) {
  const a = new Set(aWords), b = new Set(bWords);
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
function esc(s) { return String(s).replace(/'/g, "''"); }
function isValid(q) {
  for (const k of REQUIRED_FIELDS) if (!q[k] && q[k] !== 0) return false;
  if (!['A', 'B', 'C', 'D'].includes(q.correct_choice)) return false;
  if (!(Number.isInteger(q.weight) && q.weight >= 1 && q.weight <= 5)) return false;
  const choices = [q.choice_a, q.choice_b, q.choice_c, q.choice_d].map(c => (c || '').trim().toLowerCase());
  if (new Set(choices).size !== 4) return false;
  return true;
}
function splitTopLevel(s) {
  const fields = [];
  let cur = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "'" && s[i + 1] === "'") { cur += "''"; i++; continue; }
      if (c === "'") { inStr = false; cur += c; continue; }
      cur += c;
    } else {
      if (c === "'") { inStr = true; cur += c; continue; }
      if (c === ',') { fields.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function main() {
  const configPath = process.argv[2];
  const batchNum = parseInt(process.argv[3] || '1', 10);
  if (!configPath) {
    console.error('Usage: node build-track-batch.js scripts/tracks/<track>.json [batchNumber]');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  for (const k of ['examType', 'questionsDir', 'priceCents', 'handbookNote']) {
    if (!cfg[k] && cfg[k] !== 0) { console.error(`Config missing required field: ${k}`); process.exit(1); }
  }
  const outDir = cfg.outDir || path.dirname(configPath);
  const examType = cfg.examType;
  const idPrefix = `${examType}-b${batchNum}`;
  const sourceTag = `self-gen-${examType}-batch${batchNum}`;
  const createdAt = Math.floor(Date.now() / 1000);

  // 1. Load
  const files = fs.readdirSync(cfg.questionsDir).filter(f => f.endsWith('.json'));
  if (!files.length) { console.error(`No .json files found in ${cfg.questionsDir}`); process.exit(1); }
  let all = [];
  const structuralErrors = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(cfg.questionsDir, f), 'utf8'));
    arr.forEach((q, i) => {
      for (const k of REQUIRED_FIELDS) if (q[k] === undefined || q[k] === null || q[k] === '') structuralErrors.push(`${f}[${i}] missing ${k}`);
    });
    all = all.concat(arr);
  }
  console.log(`Loaded ${all.length} raw questions from ${files.length} file(s). Structural errors: ${structuralErrors.length}`);
  if (structuralErrors.length) structuralErrors.slice(0, 30).forEach(e => console.log('  ERR:', e));

  // 2. Validate
  const valid = all.filter(isValid);
  console.log(`Valid after per-item check: ${valid.length} (dropped ${all.length - valid.length})`);

  // 3. Dedupe (exact + per-topic near-dup)
  const seenExact = new Set();
  const deduped = [];
  const dropped = [];
  const withWords = valid.map(q => ({ q, words: normWords(q.question) }));
  for (const item of withWords) {
    const key = item.q.question.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seenExact.has(key)) { dropped.push({ q: item.q, reason: 'exact-dup' }); continue; }
    seenExact.add(key);
    let isDup = false;
    for (const kept of deduped) {
      if (kept.q.topic !== item.q.topic) continue;
      const sim = jaccard(item.words, kept.words);
      if (sim >= DEDUPE_THRESHOLD) { isDup = true; dropped.push({ q: item.q, reason: `near-dup (${sim.toFixed(2)}) of: ${kept.q.question.slice(0, 60)}` }); break; }
    }
    if (!isDup) deduped.push(item);
  }
  console.log(`After dedup: ${deduped.length} kept, ${dropped.length} dropped`);
  const byTopic = {};
  deduped.forEach(d => { byTopic[d.q.topic] = (byTopic[d.q.topic] || 0) + 1; });
  console.log('By topic:', JSON.stringify(byTopic, null, 2));

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${examType}_batch${batchNum}_dropped.json`), JSON.stringify(dropped.map(d => ({ reason: d.reason, question: d.q.question })), null, 2));

  // 4. Write full SQL (pricing upsert avoids the recurring UNIQUE-constraint error when admin
  // has already touched the Settings tab for this track)
  const lines = [];
  lines.push(`-- ${examType} batch ${batchNum}: pricing + question bank -- generated ${new Date(createdAt * 1000).toISOString()}`);
  lines.push(`-- Price: $${(cfg.priceCents / 100).toFixed(2)} (${cfg.priceCents} cents)`);
  lines.push(`INSERT INTO pricing (exam_type, price_cents, currency, updated_at) VALUES ('${esc(examType)}', ${cfg.priceCents}, 'USD', ${createdAt}) ON CONFLICT(exam_type) DO UPDATE SET price_cents=excluded.price_cents, currency=excluded.currency, updated_at=excluded.updated_at;`);
  lines.push(`-- ${deduped.length} questions, source='${sourceTag}', grounded in ${cfg.handbookNote}`);
  deduped.forEach((d, i) => {
    const q = d.q;
    const id = `${idPrefix}-${String(i + 1).padStart(3, '0')}`;
    lines.push(
      `INSERT INTO questions (id, exam_type, topic, question, choice_a, choice_b, choice_c, choice_d, correct_choice, explanation, weight, source_note, source, created_at) VALUES ` +
      `('${esc(id)}', '${esc(examType)}', '${esc(q.topic)}', '${esc(q.question)}', '${esc(q.choice_a)}', '${esc(q.choice_b)}', '${esc(q.choice_c)}', '${esc(q.choice_d)}', '${esc(q.correct_choice)}', '${esc(q.explanation)}', ${q.weight}, '${esc(q.source_note)}', '${esc(sourceTag)}', ${createdAt});`
    );
  });
  const sqlPath = path.join(outDir, `${examType}_batch${batchNum}.sql`);
  fs.writeFileSync(sqlPath, lines.join('\n') + '\n');
  console.log(`SQL written to ${sqlPath}, ${deduped.length + 1} statements (1 pricing + ${deduped.length} questions).`);

  // 5. Sanity-check the SQL we just wrote (quote parity + field count) before chunking
  const insertLines = lines.filter(l => l.startsWith('INSERT'));
  let badQuotes = 0;
  insertLines.forEach((l, i) => {
    const singleQuotes = (l.match(/'/g) || []).length;
    if (singleQuotes % 2 !== 0) { badQuotes++; console.log('ODD QUOTES at line', i, l.slice(0, 150)); }
  });
  const questionInserts = insertLines.filter(l => l.includes('INTO questions'));
  let badRows = 0;
  questionInserts.forEach((l, i) => {
    const m = l.match(/VALUES \((.*)\);$/s);
    if (!m) { badRows++; console.log('NO VALUES MATCH at', i); return; }
    if (splitTopLevel(m[1]).length !== 14) { badRows++; console.log('BAD FIELD COUNT at row', i); }
  });
  console.log(`SQL check: ${badQuotes} odd-quote lines, ${badRows} malformed question rows.`);
  if (badQuotes || badRows) { console.error('Aborting before chunking -- fix the SQL generation issue above first.'); process.exit(1); }

  // 6. Split into D1-Console-sized chunks
  const chunkDir = path.join(outDir, `${examType}_batch${batchNum}_chunks`);
  if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });
  const pricingLine = insertLines.find(l => l.startsWith('INSERT INTO pricing'));
  fs.writeFileSync(path.join(chunkDir, 'chunk-00-pricing.sql'), pricingLine + '\n');
  let chunkNum = 1;
  for (let i = 0; i < questionInserts.length; i += CHUNK_SIZE) {
    fs.writeFileSync(path.join(chunkDir, `chunk-${String(chunkNum).padStart(2, '0')}.sql`), questionInserts.slice(i, i + CHUNK_SIZE).join('\n') + '\n');
    chunkNum++;
  }
  console.log(`Wrote ${chunkNum} files (1 pricing + ${chunkNum - 1} question chunks of up to ${CHUNK_SIZE}) to ${chunkDir}`);

  // 7. Spot-check sample for a manual factual read before loading into D1
  console.log(`\n--- Spot check (${SPOT_CHECK_SAMPLES} samples) ---`);
  const stride = Math.max(1, Math.floor(deduped.length / SPOT_CHECK_SAMPLES));
  for (let i = Math.min(4, deduped.length - 1); i < deduped.length; i += stride) {
    const q = deduped[i].q;
    console.log('---');
    console.log('Q:', q.question);
    console.log('A:', q.choice_a, '| B:', q.choice_b, '| C:', q.choice_c, '| D:', q.choice_d);
    console.log('Correct:', q.correct_choice, '| Weight:', q.weight);
    console.log('Source:', q.source_note);
  }
}

main();
