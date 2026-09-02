#!/usr/bin/env node
// Deterministically rotates each question's four choices so the correct answer lands in a
// target letter, cycling A->B->C->D->A... in question order across all bucket files combined.
// Every question in pa_re_broker_questions/*.json is drafted with the correct answer as choice_a
// (correct_choice: "A"); this script reassigns letters so the final bank's answer distribution
// is balanced, without touching question/explanation text.
//
// Usage: node scripts/tracks/rotate_pa_re_broker_answers.js

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'pa_re_broker_questions');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();

const targets = ['A', 'B', 'C', 'D'];
let idx = 0;
const tally = { A: 0, B: 0, C: 0, D: 0 };
let total = 0;

for (const f of files) {
  const filePath = path.join(dir, f);
  const arr = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const q of arr) {
    if (q.correct_choice !== 'A') {
      console.error(`Unexpected: ${f} has a question not drafted as choice_a correct. Skipping rotation for it.`);
      continue;
    }
    const target = targets[idx % 4];
    idx++;
    total++;
    tally[target]++;

    // Original: correct answer is in choice_a, distractors in b/c/d (in that fixed order).
    const correctText = q.choice_a;
    const distractors = [q.choice_b, q.choice_c, q.choice_d];

    if (target === 'A') {
      q.choice_a = correctText;
      q.choice_b = distractors[0];
      q.choice_c = distractors[1];
      q.choice_d = distractors[2];
      q.correct_choice = 'A';
    } else if (target === 'B') {
      q.choice_a = distractors[0];
      q.choice_b = correctText;
      q.choice_c = distractors[1];
      q.choice_d = distractors[2];
      q.correct_choice = 'B';
    } else if (target === 'C') {
      q.choice_a = distractors[0];
      q.choice_b = distractors[1];
      q.choice_c = correctText;
      q.choice_d = distractors[2];
      q.correct_choice = 'C';
    } else if (target === 'D') {
      q.choice_a = distractors[0];
      q.choice_b = distractors[1];
      q.choice_c = distractors[2];
      q.choice_d = correctText;
      q.correct_choice = 'D';
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(arr, null, 2) + '\n');
  console.log(`Rotated ${arr.length} questions in ${f}`);
}

console.log(`\nTotal rotated: ${total}`);
console.log('Final distribution:', tally);
for (const k of targets) {
  console.log(`  ${k}: ${tally[k]} (${(100 * tally[k] / total).toFixed(1)}%)`);
}
