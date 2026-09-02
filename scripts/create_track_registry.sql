CREATE TABLE track_registry (
  exam_type           TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL,
  state_code           TEXT NOT NULL,
  short_name           TEXT NOT NULL,
  active               INTEGER NOT NULL DEFAULT 1,
  is_exam_required     INTEGER NOT NULL DEFAULT 1,
  exam_question_count  INTEGER NOT NULL,
  exam_duration_sec    INTEGER NOT NULL,
  pass_percent         INTEGER NOT NULL,
  min_correct          INTEGER NOT NULL,
  mechanics_note       TEXT,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX idx_track_registry_kind ON track_registry(kind);
CREATE INDEX idx_track_registry_state ON track_registry(state_code);
