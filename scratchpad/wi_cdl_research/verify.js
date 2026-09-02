const fs = require('fs');
const dir = 'C:/claudews/passexamhq/Workers/passexamhq-api/scratchpad/questions/wi_cdl';
const REQUIRED_FIELDS = ['topic', 'question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'correct_choice', 'explanation', 'weight', 'source_note'];

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
let grandTotal = 0;
let grandLetters = { A: 0, B: 0, C: 0, D: 0 };
let anyErrors = false;

for (const f of files) {
  const raw = fs.readFileSync(dir + '/' + f, 'utf8');
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (e) {
    console.log(`${f}: INVALID JSON - ${e.message}`);
    anyErrors = true;
    continue;
  }
  if (!Array.isArray(arr)) {
    console.log(`${f}: NOT AN ARRAY`);
    anyErrors = true;
    continue;
  }
  const letters = { A: 0, B: 0, C: 0, D: 0 };
  let fieldErrors = 0;
  let choiceDupErrors = 0;
  const seenQ = new Set();
  let exactDupCount = 0;
  arr.forEach((q, i) => {
    for (const k of REQUIRED_FIELDS) {
      if (q[k] === undefined || q[k] === null || q[k] === '') fieldErrors++;
    }
    if (!['A', 'B', 'C', 'D'].includes(q.correct_choice)) fieldErrors++;
    else letters[q.correct_choice]++;
    if (!(Number.isInteger(q.weight) && q.weight >= 1 && q.weight <= 5)) fieldErrors++;
    const choices = [q.choice_a, q.choice_b, q.choice_c, q.choice_d].map(c => String(c || '').trim().toLowerCase());
    if (new Set(choices).size !== 4) choiceDupErrors++;
    const key = String(q.question || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (seenQ.has(key)) exactDupCount++;
    seenQ.add(key);
  });
  const total = arr.length;
  grandTotal += total;
  for (const k of ['A', 'B', 'C', 'D']) grandLetters[k] += letters[k];
  const pct = k => total ? ((letters[k] / total) * 100).toFixed(1) : '0.0';
  const outOfBand = ['A', 'B', 'C', 'D'].filter(k => total && (letters[k] / total < 0.15 || letters[k] / total > 0.35));
  console.log(`${f}: n=${total} | A=${letters.A}(${pct('A')}%) B=${letters.B}(${pct('B')}%) C=${letters.C}(${pct('C')}%) D=${letters.D}(${pct('D')}%) | fieldErrors=${fieldErrors} choiceDup=${choiceDupErrors} exactDup=${exactDupCount} | outOfBand=${outOfBand.join(',') || 'none'}`);
  if (fieldErrors || choiceDupErrors || exactDupCount || outOfBand.length) anyErrors = true;
}

console.log('---');
console.log('GRAND TOTAL:', grandTotal, JSON.stringify(grandLetters));
const gp = k => ((grandLetters[k] / grandTotal) * 100).toFixed(1);
console.log(`Overall letter %: A=${gp('A')} B=${gp('B')} C=${gp('C')} D=${gp('D')}`);
console.log(anyErrors ? 'ISSUES FOUND ABOVE' : 'ALL CLEAN');
