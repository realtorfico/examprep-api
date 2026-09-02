#!/usr/bin/env node
// Validation pass for ga_re_broker_questions/*.json before rotation:
// - every file parses as JSON
// - every question has all required fields, non-empty
// - correct_choice is "A" for every question (pre-rotation state)
// - weight is an integer 3-5
// - no exact-duplicate question text across the whole bank
// - total question count across all files

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'ga_re_broker_questions');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();

const required = ['topic', 'question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'correct_choice', 'explanation', 'weight', 'source_note'];
let total = 0;
let errors = 0;
const seenQuestions = new Map();

for (const f of files) {
  const filePath = path.join(dir, f);
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`PARSE ERROR in ${f}: ${e.message}`);
    errors++;
    continue;
  }
  if (!Array.isArray(arr)) {
    console.error(`${f}: not an array`);
    errors++;
    continue;
  }
  arr.forEach((q, i) => {
    for (const key of required) {
      if (!(key in q) || q[key] === '' || q[key] === null || q[key] === undefined) {
        console.error(`${f}[${i}]: missing/empty field "${key}"`);
        errors++;
      }
    }
    if (q.correct_choice !== 'A') {
      console.error(`${f}[${i}]: correct_choice is "${q.correct_choice}", expected "A" pre-rotation`);
      errors++;
    }
    if (!Number.isInteger(q.weight) || q.weight < 3 || q.weight > 5) {
      console.error(`${f}[${i}]: weight "${q.weight}" out of range 3-5`);
      errors++;
    }
    const norm = (q.question || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (seenQuestions.has(norm)) {
      console.error(`DUPLICATE question text: "${q.question}" in ${f}[${i}] also in ${seenQuestions.get(norm)}`);
      errors++;
    } else {
      seenQuestions.set(norm, `${f}[${i}]`);
    }
  });
  total += arr.length;
  console.log(`${f}: ${arr.length} questions`);
}

console.log(`\nTotal questions: ${total}`);
console.log(`Total files: ${files.length}`);
console.log(errors === 0 ? 'VALIDATION PASSED' : `VALIDATION FAILED: ${errors} error(s)`);
process.exit(errors === 0 ? 0 : 1);
