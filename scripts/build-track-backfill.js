#!/usr/bin/env node
// Additive backfill pipeline: for a track that's ALREADY LIVE in D1, load the *_extra.json files
// written by a depth-backfill pass, globally dedupe against BOTH the originals and each other
// (using the same choice-aware near-dup check as build-track-batch.js), then emit SQL that inserts
// ONLY the genuinely-new surviving questions with a distinct ID prefix -- never re-emits the
// originals, which already exist in D1 under their own batch-1 IDs.
//
// Usage: node scripts/build-track-backfill.js scripts/tracks/<track>.json [backfillTag]
const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = ['topic', 'question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'correct_choice', 'explanation', 'weight', 'source_note'];
const CHUNK_SIZE = 160;
const DEDUPE_THRESHOLD = 0.72;
const CHOICE_SIM_THRESHOLD = 0.5;

const STOPWORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'and', 'or', 'but', 'if', 'you', 'your', 'it', 'this', 'that', 'as', 'from', 'which', 'what', 'when', 'where', 'how', 'does', 'do', 'did', 'must', 'may', 'can', 'not', 'no']);
function normWords(s) { return (s.toLowerCase().match(/[a-z0-9']+/g) || []).filter(w => !STOPWORDS.has(w)); }
function jaccard(aWords, bWords) {
  const a = new Set(aWords), b = new Set(bWords);
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
function choiceWords(q) { return normWords([q.choice_a, q.choice_b, q.choice_c, q.choice_d].join(' ')); }
function esc(s) { return String(s).replace(/'/g, "''"); }
function isValid(q) {
  for (const k of REQUIRED_FIELDS) if (!q[k] && q[k] !== 0) return false;
  if (!['A', 'B', 'C', 'D'].includes(q.correct_choice)) return false;
  if (!(Number.isInteger(q.weight) && q.weight >= 1 && q.weight <= 5)) return false;
  const choices = [q.choice_a, q.choice_b, q.choice_c, q.choice_d].map(c => (c || '').trim().toLowerCase());
  if (new Set(choices).size !== 4) return false;
  return true;
}

function main() {
  const configPath = process.argv[2];
  const backfillTag = process.argv[3] || 'deepen1';
  if (!configPath) {
    console.error('Usage: node build-track-backfill.js scripts/tracks/<track>.json [backfillTag]');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const outDir = cfg.outDir || path.dirname(configPath);
  const examType = cfg.examType;
  const idPrefix = `${examType}-${backfillTag}`;
  const sourceTag = `self-gen-${examType}-${backfillTag}`;
  const createdAt = Math.floor(Date.now() / 1000);

  const files = fs.readdirSync(cfg.questionsDir).filter(f => f.endsWith('.json'));
  let all = [];
  const structuralErrors = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(cfg.questionsDir, f), 'utf8'));
    const isExtra = f.includes('_extra');
    arr.forEach((q, i) => {
      for (const k of REQUIRED_FIELDS) if (q[k] === undefined || q[k] === null || q[k] === '') structuralErrors.push(`${f}[${i}] missing ${k}`);
    });
    all = all.concat(arr.map(q => ({ ...q, _file: f, _isExtra: isExtra })));
  }
  console.log(`Loaded ${all.length} raw questions from ${files.length} file(s) (originals + extras). Structural errors: ${structuralErrors.length}`);
  if (structuralErrors.length) { structuralErrors.slice(0, 30).forEach(e => console.log('  ERR:', e)); process.exit(1); }

  const valid = all.filter(isValid);
  console.log(`Valid after per-item check: ${valid.length} (dropped ${all.length - valid.length})`);

  const seenExact = new Set();
  const deduped = [];
  const dropped = [];
  const withWords = valid.map(q => ({ q, words: normWords(q.question), cwords: choiceWords(q) }));
  for (const item of withWords) {
    const key = item.q.question.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seenExact.has(key)) { dropped.push({ q: item.q, reason: 'exact-dup' }); continue; }
    seenExact.add(key);
    let isDup = false;
    for (const kept of deduped) {
      if (kept.q.topic !== item.q.topic) continue;
      const sim = jaccard(item.words, kept.words);
      if (sim < DEDUPE_THRESHOLD) continue;
      const choiceSim = jaccard(item.cwords, kept.cwords);
      if (choiceSim < CHOICE_SIM_THRESHOLD) continue;
      isDup = true; dropped.push({ q: item.q, reason: `near-dup (stem ${sim.toFixed(2)}, choices ${choiceSim.toFixed(2)}) of: ${kept.q.question.slice(0, 60)}${kept.q._isExtra ? '' : ' [ORIGINAL]'}` }); break;
    }
    if (!isDup) deduped.push(item);
  }
  console.log(`After global dedup (vs originals AND other extras): ${deduped.length} kept, ${dropped.length} dropped`);

  const originalKept = deduped.filter(d => !d.q._isExtra);
  const newKept = deduped.filter(d => d.q._isExtra);
  console.log(`Of the kept set: ${originalKept.length} were originals (already in D1, will NOT be re-inserted), ${newKept.length} are genuinely new (will be inserted).`);
  const droppedOfExtra = dropped.filter(d => d.q._isExtra).length;
  console.log(`Of the ${dropped.length} dropped: ${droppedOfExtra} were extras dropped as duplicates (of an original or another extra).`);

  const byTopic = {};
  deduped.forEach(d => { byTopic[d.q.topic] = (byTopic[d.q.topic] || 0) + 1; });
  console.log('Combined pool by topic (originals + new):', JSON.stringify(byTopic, null, 2));

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${examType}_${backfillTag}_dropped.json`), JSON.stringify(dropped.map(d => ({ reason: d.reason, isExtra: d.q._isExtra, question: d.q.question })), null, 2));

  const lines = [];
  lines.push(`-- ${examType} backfill "${backfillTag}": NEW questions only (originals already in D1) -- generated ${new Date(createdAt * 1000).toISOString()}`);
  lines.push(`-- ${newKept.length} new questions, source='${sourceTag}'`);
  newKept.forEach((d, i) => {
    const q = d.q;
    const id = `${idPrefix}-${String(i + 1).padStart(3, '0')}`;
    lines.push(
      `INSERT INTO questions (id, exam_type, topic, question, choice_a, choice_b, choice_c, choice_d, correct_choice, explanation, weight, source_note, source, created_at) VALUES ` +
      `('${esc(id)}', '${esc(examType)}', '${esc(q.topic)}', '${esc(q.question)}', '${esc(q.choice_a)}', '${esc(q.choice_b)}', '${esc(q.choice_c)}', '${esc(q.choice_d)}', '${esc(q.correct_choice)}', '${esc(q.explanation)}', ${q.weight}, '${esc(q.source_note)}', '${esc(sourceTag)}', ${createdAt});`
    );
  });
  const sqlPath = path.join(outDir, `${examType}_${backfillTag}.sql`);
  fs.writeFileSync(sqlPath, lines.join('\n') + '\n');
  console.log(`SQL written to ${sqlPath}, ${newKept.length} INSERT statements (originals excluded).`);

  const insertLines = lines.filter(l => l.startsWith('INSERT'));
  let badQuotes = 0;
  insertLines.forEach((l, i) => {
    const singleQuotes = (l.match(/'/g) || []).length;
    if (singleQuotes % 2 !== 0) { badQuotes++; console.log('ODD QUOTES at line', i, l.slice(0, 150)); }
  });
  console.log(`SQL check: ${badQuotes} odd-quote lines.`);
  if (badQuotes) { console.error('Aborting before chunking -- fix the SQL generation issue above first.'); process.exit(1); }

  const chunkDir = path.join(outDir, `${examType}_${backfillTag}_chunks`);
  if (fs.existsSync(chunkDir)) { for (const f of fs.readdirSync(chunkDir)) fs.unlinkSync(path.join(chunkDir, f)); }
  else fs.mkdirSync(chunkDir, { recursive: true });
  let chunkNum = 1;
  for (let i = 0; i < insertLines.length; i += CHUNK_SIZE) {
    fs.writeFileSync(path.join(chunkDir, `chunk-${String(chunkNum).padStart(2, '0')}.sql`), insertLines.slice(i, i + CHUNK_SIZE).join('\n') + '\n');
    chunkNum++;
  }
  console.log(`Wrote ${chunkNum - 1} chunk file(s) of up to ${CHUNK_SIZE} to ${chunkDir}`);
  console.log(`\nFINAL: originals ${originalKept.length} (already in D1) + new ${newKept.length} (to insert) = combined pool ${deduped.length}`);
}

main();
