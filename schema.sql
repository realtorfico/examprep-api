-- examprep-api D1 schema. Apply via the D1 dashboard console (no local wrangler on this machine).

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  exam_type    TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  theme        TEXT NOT NULL DEFAULT 'system',
  font_scale   REAL NOT NULL DEFAULT 1.0,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_users_token ON users(token);

CREATE TABLE codes (
  code         TEXT PRIMARY KEY,
  exam_type    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'unused', -- unused | redeemed | revoked
  note         TEXT,
  expires_at   INTEGER,                        -- epoch seconds; NULL = lifetime
  redeemed_by  TEXT REFERENCES users(id),
  redeemed_at  INTEGER,
  issued_at    INTEGER NOT NULL
);
CREATE INDEX idx_codes_exam_type ON codes(exam_type);

CREATE TABLE questions (
  id             TEXT PRIMARY KEY,
  exam_type      TEXT NOT NULL,
  topic          TEXT NOT NULL,
  question       TEXT NOT NULL,
  choice_a       TEXT NOT NULL,
  choice_b       TEXT NOT NULL,
  choice_c       TEXT NOT NULL,
  choice_d       TEXT NOT NULL,
  correct_choice TEXT NOT NULL, -- 'A' | 'B' | 'C' | 'D'
  explanation    TEXT NOT NULL,
  weight         INTEGER NOT NULL DEFAULT 3, -- 1-5, exam-likelihood
  source_note    TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_questions_exam_type ON questions(exam_type);

CREATE TABLE progress (
  user_id          TEXT NOT NULL REFERENCES users(id),
  question_id      TEXT NOT NULL REFERENCES questions(id),
  times_seen       INTEGER NOT NULL DEFAULT 0,
  times_correct    INTEGER NOT NULL DEFAULT 0,
  last_result      TEXT, -- 'correct' | 'incorrect'
  last_answered_at INTEGER,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX idx_progress_user ON progress(user_id);
