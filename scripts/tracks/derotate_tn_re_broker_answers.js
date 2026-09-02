#!/usr/bin/env node
// Inverse of rotate_tn_re_broker_answers.js -- restores every question to the "correct answer
// always in choice_a" draft convention, so newly-backfilled questions (drafted in that same
// convention) can be appended before re-running a fresh whole-track rotation.
//
// The rotation mapping is a clean bijection per target letter, so it inverts exactly:
//   target A: a=correct,b=d0,c=d1,d=d2 (unchanged)
//   target B: a=d0,b=correct,c=d1,d=d2  -> original: a=b,b=a,c=c,d=d
//   target C: a=d0,b=d1,c=correct,d=d2  -> original: a=c,b=a,c=b,d=d
//   target D: a=d0,b=d1,c=d2,d=correct  -> original: a=d,b=a,c=b,d=c
//
// Usage: node scripts/tracks/derotate_tn_re_broker_answers.js

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'tn_re_broker_questions');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();

let total = 0;
for (const f of files) {
  const filePath = path.join(dir, f);
  const arr = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const q of arr) {
    const a = q.choice_a, b = q.choice_b, c = q.choice_c, d = q.choice_d;
    if (q.correct_choice === 'A') {
      // already original
    } else if (q.correct_choice === 'B') {
      q.choice_a = b; q.choice_b = a; q.choice_c = c; q.choice_d = d;
    } else if (q.correct_choice === 'C') {
      q.choice_a = c; q.choice_b = a; q.choice_c = b; q.choice_d = d;
    } else if (q.correct_choice === 'D') {
      q.choice_a = d; q.choice_b = a; q.choice_c = b; q.choice_d = c;
    } else {
      console.error(`Unexpected correct_choice "${q.correct_choice}" in ${f} -- skipping`);
      continue;
    }
    q.correct_choice = 'A';
    total++;
  }
  fs.writeFileSync(filePath, JSON.stringify(arr, null, 2) + '\n');
  console.log(`De-rotated ${arr.length} questions in ${f}`);
}
console.log(`\nTotal de-rotated: ${total}`);
