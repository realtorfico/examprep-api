// Seed data for the paid-content security tests. Every piece of PAID content carries a unique
// marker string ("PAID-...") so a test can assert it never appears anywhere in a response body an
// unauthorized caller receives -- a much stronger check than inspecting only the fields a handler
// is expected to return. Free/public content carries "PUBLIC-..." markers instead.
//
// Public set rule (2026-09-16 decision): each active track's public questions -- the only ones the free
// sample, question of the day and MCP tools may show -- are its first N by (weight DESC, id ASC), where
// N = min(30, 10% of the track's bank). The fixture is sized so both limits are exercised:
// - ca_cdl (CDL, active): 125 questions -> N = 12 (the 10% limit). The 12 public ones are weight 5,
//   ids b1-001..012 ("PUBLIC-..."). Three MORE weight-5 questions (b1-013..015) are paid, so a surface
//   that serves the whole top-weight tier instead of the capped set is caught. Paid weight-3 questions in
//   two topics (T_OWNED: b1-101..105 + filler; T_UNOWNED: b1-201..205).
// - tx_notary (Notary, active): 400 questions -> N = 30 (the 30 cap, since 10% would be 40). 30 public
//   weight-5, then 3 paid weight-5 (b1-031..033), paid weight-2 (b1-101..105) and filler.
// - zz_cdl (CDL, INACTIVE / pulled from sale): its own questions -- nothing about it should be public.
// - Accounts: a full-track ca_cdl owner, an à la carte ca_cdl owner of T_OWNED only, a full-track
//   tx_notary owner (a customer of a DIFFERENT track), and ca_cdl accounts whose code was revoked or
//   has expired.
// - Resources on ca_cdl across both topics, paid and free: tables, flashcards, audio files (signed
//   /media URLs only), and pdf links (url). Plus a paid tx_notary table and audio file.

export const T_OWNED = 'Air Brakes, Combination Vehicles & Doubles/Triples';
export const T_UNOWNED = 'Passenger, School Bus, Tank & HazMat Endorsements';
export const TOKENS = { full: 'tok-full-cdl', topic: 'tok-topic-cdl', notary: 'tok-full-notary', revoked: 'tok-revoked-cdl', expired: 'tok-expired-cdl' };
export const USERS = { full: 'u-full-cdl', topic: 'u-topic-cdl', notary: 'u-full-notary', revoked: 'u-revoked-cdl', expired: 'u-expired-cdl' };
export const PAID_MARKERS = ['PAID-QUESTION', 'PAID-SECRET', 'PAID-TABLE-SECRET', 'PAID-CARD-SECRET', 'PAID-URL-SECRET'];

const pad = (n) => String(n).padStart(3, '0');

export function seedPaidContent(db) {
  const now = 1789000000;
  const track = db.prepare(`INSERT INTO track_registry (exam_type, kind, state_code, short_name, active, is_exam_required,
    exam_question_count, exam_duration_sec, pass_percent, min_correct, mechanics_note, updated_at) VALUES (?, ?, ?, ?, ?, 1, 10, 3600, 80, 8, NULL, ?)`);
  track.run('ca_cdl', 'Commercial Driver (CDL)', 'CA', 'CA CDL', 1, now);
  track.run('tx_notary', 'Notary', 'TX', 'TX Notary', 1, now);
  track.run('zz_cdl', 'Commercial Driver (CDL)', 'ZZ', 'ZZ CDL', 0, now);

  const kb = db.prepare('INSERT INTO track_key_breakdown (id, exam_type, label, declared_pct, sort_order) VALUES (?, ?, ?, ?, ?)');
  kb.run('ca_cdl-kb-1', 'ca_cdl', T_OWNED, 50, 0);
  kb.run('ca_cdl-kb-2', 'ca_cdl', T_UNOWNED, 50, 1);

  const q = db.prepare(`INSERT INTO questions (id, exam_type, topic, question, choice_a, choice_b, choice_c, choice_d,
    correct_choice, explanation, weight, created_at) VALUES (?, ?, ?, ?, 'a', 'b', 'c', 'd', 'A', ?, ?, ?)`);
  for (let i = 1; i <= 12; i++) {
    q.run(`ca_cdl-b1-${pad(i)}`, 'ca_cdl', T_OWNED, `PUBLIC-QUESTION ca_cdl ${i}`, `PUBLIC-EXPLANATION ca_cdl ${i}`, 5, now);
  }
  for (let i = 13; i <= 15; i++) {
    q.run(`ca_cdl-b1-${pad(i)}`, 'ca_cdl', T_OWNED, `PAID-QUESTION ca_cdl top-weight beyond cap ${i}`, `PAID-SECRET ca_cdl top-weight beyond cap ${i}`, 5, now);
  }
  for (let i = 1; i <= 30; i++) {
    q.run(`tx_notary-b1-${pad(i)}`, 'tx_notary', 'Notary Duties', `PUBLIC-QUESTION tx_notary ${i}`, `PUBLIC-EXPLANATION tx_notary ${i}`, 5, now);
  }
  for (let i = 31; i <= 33; i++) {
    q.run(`tx_notary-b1-${pad(i)}`, 'tx_notary', 'Notary Duties', `PAID-QUESTION tx_notary top-weight beyond cap ${i}`, `PAID-SECRET tx_notary top-weight beyond cap ${i}`, 5, now);
  }
  // Filler paid questions to bring the banks to 125 (ca_cdl) and 400 (tx_notary).
  for (let i = 1; i <= 100; i++) {
    q.run(`ca_cdl-b2-${pad(i)}`, 'ca_cdl', T_OWNED, `PAID-QUESTION ca_cdl filler ${i}`, `PAID-SECRET ca_cdl filler ${i}`, 3, now);
  }
  for (let i = 1; i <= 362; i++) {
    q.run(`tx_notary-b2-${pad(i)}`, 'tx_notary', 'Notary Duties', `PAID-QUESTION tx_notary filler ${i}`, `PAID-SECRET tx_notary filler ${i}`, 2, now);
  }
  for (let i = 101; i <= 105; i++) {
    q.run(`ca_cdl-b1-${i}`, 'ca_cdl', T_OWNED, `PAID-QUESTION ca_cdl owned ${i}`, `PAID-SECRET ca_cdl owned ${i}`, 3, now);
    q.run(`tx_notary-b1-${i}`, 'tx_notary', 'Notary Duties', `PAID-QUESTION tx_notary ${i}`, `PAID-SECRET tx_notary ${i}`, 2, now);
  }
  for (let i = 201; i <= 205; i++) {
    q.run(`ca_cdl-b1-${i}`, 'ca_cdl', T_UNOWNED, `PAID-QUESTION ca_cdl unowned ${i}`, `PAID-SECRET ca_cdl unowned ${i}`, 3, now);
  }
  for (let i = 1; i <= 12; i++) {
    q.run(`zz_cdl-b1-${pad(i)}`, 'zz_cdl', T_OWNED, `PAID-QUESTION zz_cdl inactive ${i}`, `PAID-SECRET zz_cdl inactive ${i}`, 5, now);
  }

  const user = db.prepare('INSERT INTO users (id, exam_type, token, created_at, last_seen_at, owned_topics_json) VALUES (?, ?, ?, ?, ?, ?)');
  user.run(USERS.full, 'ca_cdl', TOKENS.full, now, now, null);
  user.run(USERS.topic, 'ca_cdl', TOKENS.topic, now, now, JSON.stringify([T_OWNED]));
  user.run(USERS.notary, 'tx_notary', TOKENS.notary, now, now, null);
  user.run(USERS.revoked, 'ca_cdl', TOKENS.revoked, now, now, null);
  user.run(USERS.expired, 'ca_cdl', TOKENS.expired, now, now, null);
  const code = db.prepare(`INSERT INTO codes (code, exam_type, status, redeemed_by, redeemed_at, issued_at) VALUES (?, ?, 'redeemed', ?, ?, ?)`);
  code.run('CODE-FULL', 'ca_cdl', USERS.full, now, now);
  code.run('CODE-TOPIC', 'ca_cdl', USERS.topic, now, now);
  code.run('CODE-NOTARY', 'tx_notary', USERS.notary, now, now);
  db.prepare(`INSERT INTO codes (code, exam_type, status, redeemed_by, redeemed_at, issued_at) VALUES ('CODE-REVOKED', 'ca_cdl', 'revoked', ?, ?, ?)`).run(USERS.revoked, now, now);
  db.prepare(`INSERT INTO codes (code, exam_type, status, redeemed_by, redeemed_at, issued_at, expires_at) VALUES ('CODE-EXPIRED', 'ca_cdl', 'redeemed', ?, ?, ?, 1000)`).run(USERS.expired, now, now);

  const res = db.prepare(`INSERT INTO resources (id, exam_type, ord, type, title, desc, topic, free, downloadable, url, file,
    data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'desc', ?, ?, 0, NULL, NULL, ?, ?, ?)`);
  const table = (cell) => JSON.stringify({ headers: ['Fact', 'Value'], rows: [[cell, cell]], sourceNote: 'fixture' });
  const deck = (front) => JSON.stringify([{ front, back: front + ' back', source: 'fixture' }]);
  res.run('ca_cdl:paid-table-owned', 'ca_cdl', 0, 'table', 'Paid Owned Table', T_OWNED, 0, table('PAID-TABLE-SECRET ca_cdl owned'), now, now);
  res.run('ca_cdl:paid-deck-owned', 'ca_cdl', 1, 'flashcards', 'Paid Owned Deck', T_OWNED, 0, deck('PAID-CARD-SECRET ca_cdl owned'), now, now);
  res.run('ca_cdl:paid-table-unowned', 'ca_cdl', 2, 'table', 'Paid Unowned Table', T_UNOWNED, 0, table('PAID-TABLE-SECRET ca_cdl unowned'), now, now);
  res.run('ca_cdl:paid-deck-unowned', 'ca_cdl', 3, 'flashcards', 'Paid Unowned Deck', T_UNOWNED, 0, deck('PAID-CARD-SECRET ca_cdl unowned'), now, now);
  res.run('ca_cdl:free-table', 'ca_cdl', 4, 'table', 'Free Table', T_UNOWNED, 1, table('PUBLIC-TABLE ca_cdl free'), now, now);
  res.run('ca_cdl:free-deck', 'ca_cdl', 5, 'flashcards', 'Free Deck', T_UNOWNED, 1, deck('PUBLIC-CARD ca_cdl free'), now, now);
  res.run('tx_notary:paid-table', 'tx_notary', 0, 'table', 'Paid Notary Table', 'Notary Duties', 0, table('PAID-TABLE-SECRET tx_notary'), now, now);

  // Media files (served only via signed /media URLs) and link-type resources (pdf/web with a url).
  const media = db.prepare(`INSERT INTO resources (id, exam_type, ord, type, title, desc, topic, free, downloadable, url, file,
    data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'desc', ?, ?, 0, ?, ?, NULL, ?, ?)`);
  media.run('ca_cdl:paid-audio-owned', 'ca_cdl', 6, 'audio', 'Paid Owned Audio', T_OWNED, 0, null, 'paid-owned.m4a', now, now);
  media.run('ca_cdl:paid-audio-unowned', 'ca_cdl', 7, 'audio', 'Paid Unowned Audio', T_UNOWNED, 0, null, 'paid-unowned.m4a', now, now);
  media.run('ca_cdl:free-audio', 'ca_cdl', 8, 'audio', 'Free Audio', T_UNOWNED, 1, null, 'free.m4a', now, now);
  media.run('ca_cdl:paid-pdf-owned', 'ca_cdl', 9, 'pdf', 'Paid Owned PDF', T_OWNED, 0, 'https://example.com/PAID-URL-SECRET-owned.pdf', null, now, now);
  media.run('ca_cdl:paid-pdf-unowned', 'ca_cdl', 10, 'pdf', 'Paid Unowned PDF', T_UNOWNED, 0, 'https://example.com/PAID-URL-SECRET-unowned.pdf', null, now, now);
  media.run('ca_cdl:free-pdf', 'ca_cdl', 11, 'pdf', 'Free PDF', T_UNOWNED, 1, 'https://example.com/PUBLIC-URL-free.pdf', null, now, now);
  media.run('tx_notary:paid-audio', 'tx_notary', 1, 'audio', 'Paid Notary Audio', 'Notary Duties', 0, null, 'notary-paid.m4a', now, now);
}

// Realistic activity so public aggregate endpoints (stats, recent-activity ticker, leaderboards) have
// real rows to summarize -- a leak in one of those would otherwise go unnoticed on an empty database.
export function seedActivity(db) {
  const at = 1789000500;
  ['ca_cdl-b1-101', 'ca_cdl-b1-201', 'ca_cdl-b1-001'].forEach((id, i) => progressRow(db, USERS.full, id, i % 2 ? 'correct' : 'incorrect', at + i));
  progressRow(db, USERS.notary, 'tx_notary-b1-101', 'incorrect', at);
  db.prepare(`INSERT INTO exam_attempts (id, user_id, exam_type, question_ids, answers, duration_sec, started_at, submitted_at,
    score_correct, score_total, mode, pass_percent) VALUES ('att-1', ?, 'ca_cdl', ?, '{}', 3600, ?, ?, 1, 2, 'standard', 80)`)
    .run(USERS.full, JSON.stringify(['ca_cdl-b1-101', 'ca_cdl-b1-201']), at, at + 60);
  db.prepare(`INSERT INTO resource_progress (user_id, resource_file, resource_type, percent, times_opened, first_opened_at, last_opened_at)
    VALUES (?, 'paid-owned.m4a', 'audio', 50, 1, ?, ?)`).run(USERS.full, at, at);
}

export function progressRow(db, userId, questionId, result, at) {
  db.prepare(`INSERT INTO progress (user_id, question_id, times_seen, times_correct, last_result, last_choice, last_answered_at)
    VALUES (?, ?, 1, ?, ?, 'B', ?)`).run(userId, questionId, result === 'correct' ? 1 : 0, result, at);
}

export function assertNoPaidMarkers(assert, text, context) {
  for (const marker of PAID_MARKERS) {
    assert.ok(!text.includes(marker), `${context}: response must not contain paid content (found "${marker}")`);
  }
}

export const PUBLIC_SET = {
  ca_cdl: Array.from({ length: 12 }, (_, i) => `ca_cdl-b1-${pad(i + 1)}`),
  tx_notary: Array.from({ length: 30 }, (_, i) => `tx_notary-b1-${pad(i + 1)}`),
};
