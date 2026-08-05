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

export const PROGRESS_BY_TOPIC_SQL =
  `SELECT q.topic, SUM(p.times_seen) AS total, SUM(p.times_correct) AS correct
   FROM progress p JOIN questions q ON q.id = p.question_id
   WHERE p.user_id = ? GROUP BY q.topic`;

export const CONSOLE_QUIZ_PROGRESS_SQL =
  `SELECT p.user_id, u.exam_type, c.code, c.buyer_email, q.topic,
          SUM(p.times_seen) AS total, SUM(p.times_correct) AS correct
   FROM progress p
   JOIN questions q ON q.id = p.question_id
   JOIN users u ON u.id = p.user_id
   LEFT JOIN codes c ON c.redeemed_by = u.id
   GROUP BY p.user_id, q.topic
   ORDER BY p.user_id`;

export const STATS_ACCURACY_BY_TOPIC_SQL =
  `SELECT q.exam_type, q.topic, SUM(p.times_seen) AS attempts, SUM(p.times_correct) AS correct
   FROM progress p JOIN questions q ON q.id = p.question_id
   GROUP BY q.exam_type, q.topic`;
