// Reusable per-track resource-insert generator for the D1 `resources` table (see schema.sql).
// Usage: node scripts/gen_resource_inserts.js <input.js> <output.sql>
// <input.js> must `module.exports = { examType, entries: [...] }` where each entry is:
//   { type, title, desc, topic, free?, downloadable?, url?, file?, table?, flashcards? }
// `ord` is assigned automatically from array order. `id` is derived as `<examType>:<slug-of-title>`.
// Run the generated SQL with: wrangler d1 execute examprep --remote --file=<output.sql>

const fs = require('fs');
const path = require('path');

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function sqlStr(v) {
  if (v === undefined || v === null) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function sqlInt(v) {
  return v ? 1 : 0;
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node gen_resource_inserts.js <input.js> <output.sql>');
  process.exit(1);
}

const { examType, entries } = require(path.resolve(inputPath));
const now = Math.floor(Date.now() / 1000);

const lines = [`DELETE FROM resources WHERE exam_type = ${sqlStr(examType)};`];
entries.forEach((e, i) => {
  const id = `${examType}:${slug(e.title)}`;
  const dataJson = e.table ? JSON.stringify(e.table) : e.flashcards ? JSON.stringify(e.flashcards) : null;
  lines.push(
    'INSERT INTO resources (id, exam_type, ord, type, title, desc, topic, free, downloadable, url, file, data_json, created_at, updated_at) VALUES (' +
      [sqlStr(id), sqlStr(examType), i, sqlStr(e.type), sqlStr(e.title), sqlStr(e.desc), sqlStr(e.topic),
       sqlInt(e.free), sqlInt(e.downloadable), sqlStr(e.url), sqlStr(e.file), sqlStr(dataJson), now, now].join(', ') +
      ');'
  );
});
fs.writeFileSync(outputPath, lines.join('\n') + '\n');
console.log(`Wrote ${entries.length} entries for ${examType} to ${outputPath}`);
