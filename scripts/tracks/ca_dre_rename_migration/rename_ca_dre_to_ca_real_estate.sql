-- One-time migration: rename examType 'ca_dre' -> 'ca_real_estate' to match this project's
-- {state}_{category} naming convention used by every other state's real-estate track.
-- Confirmed with the user 2026-08-24: no users have signed up under ca_dre yet, so this is a
-- low-risk rename, not a live-data-preserving migration. Covers every table with an exam_type
-- column; UPDATEs on empty tables (codes/exam_attempts/pending_redemptions, likely users too)
-- are harmless no-ops. question/progress row `id` values keep their historical 'ca_dre-b1-...'
-- prefix (cosmetic only, nothing in the codebase parses id strings by prefix) -- not renamed.
-- Paste this whole file into the D1 Console and run once.

UPDATE questions SET exam_type = 'ca_real_estate' WHERE exam_type = 'ca_dre';
UPDATE pricing SET exam_type = 'ca_real_estate' WHERE exam_type = 'ca_dre';
UPDATE users SET exam_type = 'ca_real_estate' WHERE exam_type = 'ca_dre';
UPDATE codes SET exam_type = 'ca_real_estate' WHERE exam_type = 'ca_dre';
UPDATE exam_attempts SET exam_type = 'ca_real_estate' WHERE exam_type = 'ca_dre';
UPDATE pending_redemptions SET exam_type = 'ca_real_estate' WHERE exam_type = 'ca_dre';
