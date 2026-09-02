#!/usr/bin/env node
// Generates ga_re_broker_registry.sql from the handbookNote in ga_re_broker.json, mirroring the
// exact column shape of oh_re_broker_registry.sql, with proper SQL single-quote escaping.

const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'ga_re_broker.json'), 'utf8'));
const mechanicsNote = manifest.handbookNote;

function sqlEscape(s) {
  return s.replace(/'/g, "''");
}

const examType = 'ga_re_broker';
const kind = 'Real Estate Broker';
const stateCode = 'GA';
const shortName = 'Georgia Real Estate Broker';
const active = 1;
const isExamRequired = 1;
const examQuestionCount = 148;
const examDurationSec = 14400; // HEDGE: no source found for total exam time; estimated at 4 hours (240 min), a common PSI-administered combined national+state real-estate-exam allotment, NOT independently confirmed for Georgia's broker exam specifically -- flagged explicitly in mechanics_note below.
const passPercent = 75;
const minCorrect = 111;
const updatedAt = Math.floor(Date.now() / 1000);

const sql = `INSERT INTO track_registry (exam_type, kind, state_code, short_name, active, is_exam_required, exam_question_count, exam_duration_sec, pass_percent, min_correct, mechanics_note, updated_at) VALUES ('${examType}', '${kind}', '${stateCode}', '${shortName}', ${active}, ${isExamRequired}, ${examQuestionCount}, ${examDurationSec}, ${passPercent}, ${minCorrect}, '${sqlEscape(mechanicsNote)}', ${updatedAt});\n`;

fs.writeFileSync(path.join(__dirname, 'ga_re_broker_registry.sql'), sql);
console.log('Wrote ga_re_broker_registry.sql, length:', sql.length);
