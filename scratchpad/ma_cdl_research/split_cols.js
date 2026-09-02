const fs = require('fs');
const lines = fs.readFileSync('ma_cdl_manual_full.txt', 'utf-8').split(/\r?\n/);

const start = 8055;
const end = 8834;
const footers = [8070,8161,8221,8305,8376,8447,8512,8585,8637,8705,8772,8825,8831];

const blocks = [];
let prev = start;
for (const f of footers) {
  blocks.push([prev, f]);
  prev = f + 1;
}
blocks.push([prev, end]);

function isBoilerplate(s) {
  if (/^Section 9 - Hazardous Material\s*(Page 9-\d+)?\s*$/.test(s)) return true;
  if (/^Version: July 2017/.test(s)) return true;
  if (/^Commercial Driver's License Manual/.test(s)) return true;
  if (/^\s*Page 9-\d+\s*$/.test(s)) return true;
  return false;
}

const out = [];
for (const [bs, be] of blocks) {
  const leftCol = [];
  const rightCol = [];
  for (let ln = bs; ln <= be; ln++) {
    if (ln - 1 >= lines.length) continue;
    let raw = lines[ln - 1];
    if (raw === undefined) continue;
    raw = raw.replace(/\s+$/, '');
    if (isBoilerplate(raw)) continue;
    const raw2 = raw.replace(/\s+Page 9-\d+\s*$/, '');
    if (raw2.length > 70) {
      const left = raw2.slice(0, 66).replace(/\s+$/, '');
      const right = raw2.slice(66).replace(/\s+$/, '');
      if (left.trim()) leftCol.push(left);
      if (right.trim()) rightCol.push(right);
    } else {
      if (raw2.trim()) leftCol.push(raw2);
    }
  }
  out.push(`=== PAGE BLOCK lines ${bs}-${be} : LEFT COLUMN ===`);
  out.push(...leftCol);
  out.push(`=== PAGE BLOCK lines ${bs}-${be} : RIGHT COLUMN ===`);
  out.push(...rightCol);
}

fs.writeFileSync('reconstructed_hazmat_b.txt', out.join('\n'));
console.log('done', out.length);
