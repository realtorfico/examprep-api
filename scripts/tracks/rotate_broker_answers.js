#!/usr/bin/env node
// Deterministically rotates each question's four choices so the correct answer lands in a
// target letter, cycling A->B->C->D->A... in question order across all bucket files combined.
// Unlike the older per-state rotate_<state>_re_broker_answers.js scripts (which assumed every
// question was drafted with correct_choice: "A"), this version reads the correct answer out of
// whatever slot it's currently in -- the parallel drafting agents for this batch of states were
// told not to worry about initial A/B/C/D placement, so correct answers arrive scattered across
// all four letters already.
//
// Usage: node scripts/tracks/rotate_broker_answers.js <questionsDirName>
//   e.g. node scripts/tracks/rotate_broker_answers.js ky_re_broker_questions

const fs = require('fs');
const path = require('path');

const dirName = process.argv[2];
if (!dirName) {
  console.error('Usage: node rotate_broker_answers.js <questionsDirName>');
  process.exit(1);
}
const dir = path.join(__dirname, dirName);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();

const targets = ['A', 'B', 'C', 'D'];
let idx = 0;
const tally = { A: 0, B: 0, C: 0, D: 0 };
let total = 0;

for (const f of files) {
  const filePath = path.join(dir, f);
  const arr = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const q of arr) {
    const slots = { A: q.choice_a, B: q.choice_b, C: q.choice_c, D: q.choice_d };
    if (!['A', 'B', 'C', 'D'].includes(q.correct_choice)) {
      console.error(`Unexpected: ${f} has an invalid correct_choice "${q.correct_choice}". Skipping.`);
      continue;
    }
    const correctText = slots[q.correct_choice];
    const distractors = targets.filter(t => t !== q.correct_choice).map(t => slots[t]);

    const target = targets[idx % 4];
    idx++;
    total++;
    tally[target]++;

    if (target === 'A') {
      q.choice_a = correctText; q.choice_b = distractors[0]; q.choice_c = distractors[1]; q.choice_d = distractors[2];
    } else if (target === 'B') {
      q.choice_a = distractors[0]; q.choice_b = correctText; q.choice_c = distractors[1]; q.choice_d = distractors[2];
    } else if (target === 'C') {
      q.choice_a = distractors[0]; q.choice_b = distractors[1]; q.choice_c = correctText; q.choice_d = distractors[2];
    } else {
      q.choice_a = distractors[0]; q.choice_b = distractors[1]; q.choice_c = distractors[2]; q.choice_d = correctText;
    }
    q.correct_choice = target;
  }
  fs.writeFileSync(filePath, JSON.stringify(arr, null, 2) + '\n');
  console.log(`Rotated ${arr.length} questions in ${f}`);
}

console.log(`\nTotal rotated: ${total}`);
console.log('Final distribution:', tally);
for (const k of targets) {
  console.log(`  ${k}: ${tally[k]} (${(100 * tally[k] / total).toFixed(1)}%)`);
}
