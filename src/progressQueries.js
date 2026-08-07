// Single source of truth for the "cumulative attempts" progress-totals SQL shared by the
// student site (/answer, /progress/summary, /progress) and the admin console (per-user and
// global accuracy views). All four must agree on totals -- see test/progress-consistency.test.js,
// added 2026-08-05 after these drifted out of sync when the SQL was duplicated inline at each
// call site instead of shared like this.
//
// Deliberately SUM(times_seen)/SUM(times_correct) (cumulative attempts), NOT COUNT(*)/last_result
// (distinct-question current-state) -- a question missed, then resurfaced and missed again, must
// count as two wrong attempts here even though it's one row in `progress`. Current-state queries
// (the missed-question picker, the wrongQuestions review list) are intentionally NOT here; those
// two correctly want "is this wrong right now", not attempt history.

export const PROGRESS_TOTALS_SQL =
  `SELECT SUM(times_seen) AS total, SUM(times_correct) AS correct FROM progress WHERE user_id = ?`;

// LEFT JOIN'd from questions (not progress) so every topic in the user's exam_type shows up, even
// ones with zero attempts -- needed for the "coverage" columns (seen/topicTotal) added 2026-08-07:
// a topic the user hasn't touched at all is exactly the 0%-coverage case the feature exists to
// surface, so it can't be missing from the result set the way an INNER JOIN from progress would
// leave it. seen/topicTotal are cumulative-attempts-agnostic (COUNT of distinct questions), unlike
// total/correct which stay SUM(times_seen)/SUM(times_correct) for consistency with progressTotals.
export const PROGRESS_BY_TOPIC_SQL =
  `SELECT q.topic,
          COALESCE(SUM(p.times_seen), 0) AS total, COALESCE(SUM(p.times_correct), 0) AS correct,
          COUNT(p.question_id) AS seen, COUNT(q.id) AS topicTotal
   FROM questions q
   LEFT JOIN progress p ON p.question_id = q.id AND p.user_id = ?
   WHERE q.exam_type = ?
   GROUP BY q.topic`;

// Same LEFT JOIN idea, scoped to users who have at least one progress row (i.e. the same set of
// "active" users this admin view already showed before coverage existed) crossed with every topic
// in their own exam_type, so an already-active user's untouched topics show up as 0% coverage
// instead of being absent from their breakdown entirely.
export const CONSOLE_QUIZ_PROGRESS_SQL =
  `SELECT u.id AS user_id, u.exam_type, c.code, c.buyer_email, q.topic,
          COALESCE(SUM(p.times_seen), 0) AS total, COALESCE(SUM(p.times_correct), 0) AS correct,
          COUNT(p.question_id) AS seen, COUNT(q.id) AS topicTotal
   FROM (SELECT DISTINCT user_id FROM progress) active
   JOIN users u ON u.id = active.user_id
   JOIN questions q ON q.exam_type = u.exam_type
   LEFT JOIN progress p ON p.question_id = q.id AND p.user_id = u.id
   LEFT JOIN codes c ON c.redeemed_by = u.id
   GROUP BY u.id, q.topic
   ORDER BY u.id`;

export const STATS_ACCURACY_BY_TOPIC_SQL =
  `SELECT q.exam_type, q.topic, SUM(p.times_seen) AS attempts, SUM(p.times_correct) AS correct
   FROM progress p JOIN questions q ON q.id = p.question_id
   GROUP BY q.exam_type, q.topic`;
