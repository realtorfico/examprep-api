import { verifyTurnstile, requireUser, requireAccess, newId, newCode } from './lib/auth.js';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}
const now = () => Math.floor(Date.now() / 1000);

// ---- Public endpoints (bearer-token auth via requireUser) -----------------

async function handleRedeem(request, env) {
  const { code, turnstileToken } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!code) return json({ error: 'code_required' }, 400);

  const row = await env.DB.prepare('SELECT * FROM codes WHERE code = ?').bind(code.trim().toUpperCase()).first();
  if (!row) return json({ error: 'invalid_code' }, 404);
  if (row.status === 'revoked') return json({ error: 'code_revoked' }, 403);
  if (row.expires_at && row.expires_at < now()) return json({ error: 'code_expired' }, 403);

  const token = crypto.randomUUID();

  if (row.status === 'unused') {
    const userId = newId();
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO users (id, exam_type, token, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(userId, row.exam_type, token, now(), now()),
      env.DB.prepare(
        "UPDATE codes SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE code = ?"
      ).bind(userId, now(), row.code),
    ]);
    return json({ token, examType: row.exam_type, isNewRedemption: true });
  }

  // Already redeemed: re-entering the code from a new device re-logs-in the same account.
  await env.DB.prepare('UPDATE users SET token = ?, last_seen_at = ? WHERE id = ?')
    .bind(token, now(), row.redeemed_by).run();
  return json({ token, examType: row.exam_type, isNewRedemption: false });
}

async function handleNextQuestion(user, env) {
  const unseen = await env.DB.prepare(
    `SELECT q.* FROM questions q LEFT JOIN progress p ON p.question_id = q.id AND p.user_id = ?
     WHERE q.exam_type = ? AND p.question_id IS NULL ORDER BY q.weight DESC, RANDOM() LIMIT 1`
  ).bind(user.id, user.exam_type).first();
  if (unseen) return json(toPublicQuestion(unseen));

  const missed = await env.DB.prepare(
    `SELECT q.* FROM questions q JOIN progress p ON p.question_id = q.id
     WHERE p.user_id = ? AND p.last_result = 'incorrect' ORDER BY RANDOM() LIMIT 1`
  ).bind(user.id).first();
  if (missed) return json(toPublicQuestion(missed));

  const review = await env.DB.prepare(
    `SELECT q.* FROM questions q JOIN progress p ON p.question_id = q.id
     WHERE p.user_id = ? ORDER BY RANDOM() LIMIT 1`
  ).bind(user.id).first();
  if (review) return json(toPublicQuestion(review));

  return json({ error: 'no_questions' }, 404);
}

function toPublicQuestion(q) {
  return {
    id: q.id, topic: q.topic, question: q.question,
    choices: { A: q.choice_a, B: q.choice_b, C: q.choice_c, D: q.choice_d },
  };
}

async function handleAnswer(user, request, env) {
  const { questionId, choice } = await request.json();
  const q = await env.DB.prepare('SELECT * FROM questions WHERE id = ?').bind(questionId).first();
  if (!q) return json({ error: 'question_not_found' }, 404);

  const correct = choice === q.correct_choice;
  await env.DB.prepare(
    `INSERT INTO progress (user_id, question_id, times_seen, times_correct, last_result, last_answered_at)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT (user_id, question_id) DO UPDATE SET
       times_seen = times_seen + 1,
       times_correct = times_correct + excluded.times_correct,
       last_result = excluded.last_result,
       last_answered_at = excluded.last_answered_at`
  ).bind(user.id, questionId, correct ? 1 : 0, correct ? 'correct' : 'incorrect', now()).run();

  return json({ correct, correctChoice: q.correct_choice, explanation: q.explanation });
}

async function handleProgress(user, env) {
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN last_result = 'correct' THEN 1 ELSE 0 END) AS correct
     FROM progress WHERE user_id = ?`
  ).bind(user.id).first();

  const byTopic = await env.DB.prepare(
    `SELECT q.topic, COUNT(*) AS total, SUM(CASE WHEN p.last_result = 'correct' THEN 1 ELSE 0 END) AS correct
     FROM progress p JOIN questions q ON q.id = p.question_id
     WHERE p.user_id = ? GROUP BY q.topic`
  ).bind(user.id).all();

  return json({
    totalAnswered: totals.total || 0,
    totalCorrect: totals.correct || 0,
    byTopic: byTopic.results,
  });
}

async function handlePrefsGet(user) {
  return json({ theme: user.theme, fontScale: user.font_scale });
}
async function handlePrefsSet(user, request, env) {
  const { theme, fontScale } = await request.json();
  await env.DB.prepare('UPDATE users SET theme = ?, font_scale = ? WHERE id = ?')
    .bind(theme ?? user.theme, fontScale ?? user.font_scale, user.id).run();
  return json({ ok: true });
}

// ---- Admin endpoints (console/*, Cloudflare Access-gated) ------------------

async function handleCodesGenerate(request, env) {
  const { examType, note, expiresInDays } = await request.json();
  if (!examType) return json({ error: 'examType_required' }, 400);
  const code = newCode();
  const expiresAt = expiresInDays ? now() + expiresInDays * 86400 : null;
  await env.DB.prepare(
    'INSERT INTO codes (code, exam_type, note, expires_at, issued_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(code, examType, note || null, expiresAt, now()).run();
  return json({ code, examType, expiresAt });
}

async function handleCodesList(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const stmt = status
    ? env.DB.prepare('SELECT * FROM codes WHERE status = ? ORDER BY issued_at DESC LIMIT 200').bind(status)
    : env.DB.prepare('SELECT * FROM codes ORDER BY issued_at DESC LIMIT 200');
  return json({ codes: (await stmt.all()).results });
}

async function handleCodesRevoke(request, env) {
  const { code } = await request.json();
  await env.DB.prepare("UPDATE codes SET status = 'revoked' WHERE code = ?").bind(code).run();
  return json({ ok: true });
}

async function handleQuestionsList(request, env) {
  const url = new URL(request.url);
  const examType = url.searchParams.get('examType');
  const topic = url.searchParams.get('topic');
  let sql = 'SELECT * FROM questions WHERE 1=1';
  const binds = [];
  if (examType) { sql += ' AND exam_type = ?'; binds.push(examType); }
  if (topic) { sql += ' AND topic = ?'; binds.push(topic); }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  return json({ questions: (await env.DB.prepare(sql).bind(...binds).all()).results });
}

function questionFromBody(b) {
  return [b.examType, b.topic, b.question, b.choiceA, b.choiceB, b.choiceC, b.choiceD,
    b.correctChoice, b.explanation, b.weight ?? 3, b.sourceNote || null];
}

async function handleQuestionCreate(request, env) {
  const b = await request.json();
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO questions (id, exam_type, topic, question, choice_a, choice_b, choice_c, choice_d,
       correct_choice, explanation, weight, source_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, ...questionFromBody(b), now()).run();
  return json({ id });
}

async function handleQuestionUpdate(request, env) {
  const b = await request.json();
  if (!b.id) return json({ error: 'id_required' }, 400);
  await env.DB.prepare(
    `UPDATE questions SET exam_type=?, topic=?, question=?, choice_a=?, choice_b=?, choice_c=?, choice_d=?,
       correct_choice=?, explanation=?, weight=?, source_note=? WHERE id = ?`
  ).bind(...questionFromBody(b), b.id).run();
  return json({ ok: true });
}

async function handleQuestionDelete(request, env) {
  const { id } = await request.json();
  await env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function handleQuestionImport(request, env) {
  const { questions } = await request.json();
  if (!Array.isArray(questions) || !questions.length) return json({ error: 'questions_required' }, 400);
  const stmts = questions.map((b) =>
    env.DB.prepare(
      `INSERT INTO questions (id, exam_type, topic, question, choice_a, choice_b, choice_c, choice_d,
         correct_choice, explanation, weight, source_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newId(), ...questionFromBody(b), now())
  );
  await env.DB.batch(stmts);
  return json({ imported: stmts.length });
}

async function handleStats(env) {
  const codes = await env.DB.prepare(
    `SELECT exam_type, status, COUNT(*) AS n FROM codes GROUP BY exam_type, status`
  ).all();
  const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const accuracy = await env.DB.prepare(
    `SELECT q.exam_type, q.topic, COUNT(*) AS attempts,
       SUM(CASE WHEN p.last_result = 'correct' THEN 1 ELSE 0 END) AS correct
     FROM progress p JOIN questions q ON q.id = p.question_id
     GROUP BY q.exam_type, q.topic`
  ).all();
  return json({ codes: codes.results, totalUsers: users.n, accuracyByTopic: accuracy.results });
}

// ---- Router -----------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (pathname === '/redeem' && method === 'POST') return await handleRedeem(request, env);

      if (pathname.startsWith('/console/')) {
        if (!(await requireAccess(request, env))) return json({ error: 'unauthorized' }, 401);
        if (pathname === '/console/codes' && method === 'GET') return await handleCodesList(request, env);
        if (pathname === '/console/codes/generate' && method === 'POST') return await handleCodesGenerate(request, env);
        if (pathname === '/console/codes/revoke' && method === 'POST') return await handleCodesRevoke(request, env);
        if (pathname === '/console/questions' && method === 'GET') return await handleQuestionsList(request, env);
        if (pathname === '/console/questions/create' && method === 'POST') return await handleQuestionCreate(request, env);
        if (pathname === '/console/questions/update' && method === 'POST') return await handleQuestionUpdate(request, env);
        if (pathname === '/console/questions/delete' && method === 'POST') return await handleQuestionDelete(request, env);
        if (pathname === '/console/questions/import' && method === 'POST') return await handleQuestionImport(request, env);
        if (pathname === '/console/stats' && method === 'GET') return await handleStats(env);
        return json({ error: 'not_found' }, 404);
      }

      // Everything else requires a valid bearer token.
      const user = await requireUser(request, env);
      if (!user) return json({ error: 'unauthorized' }, 401);

      if (pathname === '/questions/next' && method === 'GET') return await handleNextQuestion(user, env);
      if (pathname === '/answer' && method === 'POST') return await handleAnswer(user, request, env);
      if (pathname === '/progress' && method === 'GET') return await handleProgress(user, env);
      if (pathname === '/prefs' && method === 'GET') return await handlePrefsGet(user);
      if (pathname === '/prefs' && method === 'POST') return await handlePrefsSet(user, request, env);

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'internal_error', message: err.message }, 500);
    }
  },
};
