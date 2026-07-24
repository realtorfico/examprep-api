import { verifyTurnstile, requireUser, requireAccess, getAccessEmail, newId, newCode } from './lib/auth.js';
import { createPayPalOrder, capturePayPalOrder } from './lib/paypal.js';
import { sendCodeEmail, sendReferralInviteEmail, sendPointsEarnedEmail } from './lib/email.js';

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

// No auth required — a small taste of the real question bank so visitors can see the
// experience before buying/redeeming a code. Correct answers are included directly in
// the response (unlike the real quiz flow) since there's no progress to protect here.
async function handleSample(request, env) {
  const url = new URL(request.url);
  const examType = url.searchParams.get('examType') || 'notary';
  const rows = await env.DB.prepare(
    'SELECT * FROM questions WHERE exam_type = ? ORDER BY weight DESC, RANDOM() LIMIT 5'
  ).bind(examType).all();
  return json({
    questions: rows.results.map((q) => ({
      id: q.id, topic: q.topic, question: q.question,
      choices: { A: q.choice_a, B: q.choice_b, C: q.choice_c, D: q.choice_d },
      correctChoice: q.correct_choice, explanation: q.explanation,
    })),
  });
}

const DEFAULT_PRICE_CENTS = 499; // fallback if the `pricing` table has no row yet for an exam type

async function getPrice(env, examType) {
  const row = await env.DB.prepare('SELECT * FROM pricing WHERE exam_type = ?').bind(examType).first();
  return row ? { priceCents: row.price_cents, currency: row.currency } : { priceCents: DEFAULT_PRICE_CENTS, currency: 'USD' };
}

async function handlePricingGet(request, env) {
  const url = new URL(request.url);
  const examType = url.searchParams.get('examType') || 'notary';
  const { priceCents, currency } = await getPrice(env, examType);
  return json({ examType, priceCents, currency });
}

// Shared by /paypal/capture-order and (later) /points/redeem — generates a fresh code and
// immediately auto-redeems it (mint token + create user + flip code to redeemed), mirroring
// /redeem's unused-code branch, so the buyer never has to separately type their own code in.
async function issueAndRedeemCode(env, examType, note) {
  const code = newCode();
  const token = crypto.randomUUID();
  const userId = newId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO codes (code, exam_type, note, issued_at) VALUES (?, ?, ?, ?)')
      .bind(code, examType, note, now()),
    env.DB.prepare('INSERT INTO users (id, exam_type, token, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, examType, token, now(), now()),
    env.DB.prepare("UPDATE codes SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE code = ?")
      .bind(userId, now(), code),
  ]);
  return { code, token };
}

async function handlePaypalCreateOrder(request, env) {
  const { examType, turnstileToken } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!examType) return json({ error: 'examType_required' }, 400);

  const { priceCents, currency } = await getPrice(env, examType);
  const order = await createPayPalOrder(env, priceCents, currency);
  return json({ orderId: order.id });
}

async function handlePaypalCaptureOrder(request, env) {
  const { orderId, examType, email } = await request.json();
  if (!orderId || !examType) return json({ error: 'orderId_and_examType_required' }, 400);

  // Idempotency: a retried capture call for an order we've already issued a code for just
  // re-mints a token for the existing account, instead of risking a double-issue.
  const note = `paypal:${orderId}`;
  const existing = await env.DB.prepare('SELECT * FROM codes WHERE note = ?').bind(note).first();
  if (existing) {
    const token = crypto.randomUUID();
    await env.DB.prepare('UPDATE users SET token = ?, last_seen_at = ? WHERE id = ?')
      .bind(token, now(), existing.redeemed_by).run();
    return json({ code: existing.code, token, examType: existing.exam_type });
  }

  const { priceCents: expectedCents } = await getPrice(env, examType);
  const capture = await capturePayPalOrder(env, orderId);
  if (capture.status !== 'COMPLETED') return json({ error: 'payment_not_completed' }, 402);

  const captured = capture.purchase_units && capture.purchase_units[0] &&
    capture.purchase_units[0].payments && capture.purchase_units[0].payments.captures &&
    capture.purchase_units[0].payments.captures[0];
  const capturedCents = captured ? Math.round(parseFloat(captured.amount.value) * 100) : 0;
  if (capturedCents !== expectedCents) return json({ error: 'amount_mismatch' }, 402);

  const { code, token } = await issueAndRedeemCode(env, examType, note);

  if (email) {
    try { await sendCodeEmail(env, email, code, examType); } catch (e) { /* best-effort, buyer already has the code on-screen */ }
  }

  // PayPal's own capture response tells us the payer's email for free — no extra field/friction
  // needed on the buy form to detect "this buyer was someone's referral."
  const payerEmail = capture.payer && capture.payer.email_address;
  await detectAndCreditConversion(env, payerEmail);

  return json({ code, token, examType });
}

// ---- Refer & earn points ----------------------------------------------

async function getOrCreateAccount(env, email, name) {
  const existing = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
  if (existing) return existing;
  const id = newId();
  await env.DB.prepare('INSERT INTO accounts (id, email, name, points, created_at) VALUES (?, ?, ?, 0, ?)')
    .bind(id, email, name || null, now()).run();
  return { id, email, name: name || null, points: 0, created_at: now() };
}

// Looks up the current point value for a task and credits it — returns 0 (no-op) if the rule
// is missing or an admin has turned it off, so disabling an earning path never breaks the
// underlying action (verification/conversion still records normally either way).
async function awardPoints(env, accountId, taskKey) {
  const rule = await env.DB.prepare('SELECT * FROM point_rules WHERE task_key = ? AND active = 1').bind(taskKey).first();
  if (!rule) return 0;
  await env.DB.prepare('UPDATE accounts SET points = points + ? WHERE id = ?').bind(rule.points, accountId).run();
  return rule.points;
}

async function handleReferralInvite(request, env) {
  const { referrerEmail, referrerName, referredEmail, referredName, turnstileToken } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!referrerEmail || !referredEmail) return json({ error: 'emails_required' }, 400);
  const referrerEmailNorm = referrerEmail.trim().toLowerCase();
  const referredEmailNorm = referredEmail.trim().toLowerCase();
  if (referrerEmailNorm === referredEmailNorm) return json({ error: 'cannot_refer_yourself' }, 400);

  const referrer = await getOrCreateAccount(env, referrerEmailNorm, referrerName);

  // Rate limit: protects Resend sending-domain reputation from spam-blast abuse.
  const dayAgo = now() - 86400;
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM referrals WHERE referrer_account_id = ? AND created_at > ?'
  ).bind(referrer.id, dayAgo).first();
  if (recent.n >= 20) return json({ error: 'rate_limited' }, 429);

  const verifyToken = crypto.randomUUID();
  try {
    await env.DB.prepare(
      'INSERT INTO referrals (id, referrer_account_id, referred_email, referred_name, verify_token, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(newId(), referrer.id, referredEmailNorm, referredName || null, verifyToken, now()).run();
  } catch (e) {
    return json({ error: 'already_referred' }, 409); // UNIQUE constraint on referred_email
  }

  try {
    const verifyUrl = `https://examprep.softician.com/notary#/refer-verify/${verifyToken}`;
    await sendReferralInviteEmail(env, referredEmailNorm, referrerName, verifyUrl);
  } catch (e) { /* referral row still exists even if the invite email fails to send */ }

  return json({ ok: true });
}

async function handleReferralVerify(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'token_required' }, 400);

  const referral = await env.DB.prepare('SELECT * FROM referrals WHERE verify_token = ?').bind(token).first();
  if (!referral) return json({ error: 'invalid_token' }, 404);
  if (referral.status !== 'invited') return json({ ok: true, alreadyVerified: true });

  await env.DB.prepare("UPDATE referrals SET status = 'verified', verified_at = ? WHERE id = ?")
    .bind(now(), referral.id).run();

  const pointsAwarded = await awardPoints(env, referral.referrer_account_id, 'referral_verified');
  if (pointsAwarded > 0) {
    const referrer = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(referral.referrer_account_id).first();
    if (referrer) {
      try { await sendPointsEarnedEmail(env, referrer.email, pointsAwarded, 'a friend confirmed your referral'); } catch (e) {}
    }
  }

  return json({ ok: true, alreadyVerified: false });
}

// Shared by /paypal/capture-order and /points/redeem — best-effort, never throws, so a
// purchase/redemption never fails just because this bookkeeping step hit a snag.
async function detectAndCreditConversion(env, buyerEmail) {
  if (!buyerEmail) return;
  try {
    const email = buyerEmail.trim().toLowerCase();
    const referral = await env.DB.prepare(
      "SELECT * FROM referrals WHERE referred_email = ? AND status = 'verified' AND converted_at IS NULL"
    ).bind(email).first();
    if (!referral) return;

    await env.DB.prepare("UPDATE referrals SET status = 'converted', converted_at = ? WHERE id = ?")
      .bind(now(), referral.id).run();

    const pointsAwarded = await awardPoints(env, referral.referrer_account_id, 'referral_converted');
    if (pointsAwarded > 0) {
      const referrer = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(referral.referrer_account_id).first();
      if (referrer) await sendPointsEarnedEmail(env, referrer.email, pointsAwarded, 'your referral signed up for a course');
    }
  } catch (e) { /* best-effort */ }
}

async function handlePointsBalance(request, env) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return json({ error: 'email_required' }, 400);
  const account = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
  const rows = (await env.DB.prepare('SELECT * FROM exam_points_required').all()).results;
  return json({
    points: account ? account.points : 0,
    examTypes: rows.map((r) => ({ examType: r.exam_type, pointsRequired: r.points_required })),
  });
}

async function handlePointsRedeem(request, env) {
  const { email, examType, turnstileToken } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!email || !examType) return json({ error: 'email_and_examType_required' }, 400);

  const normalizedEmail = email.trim().toLowerCase();
  const account = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(normalizedEmail).first();
  if (!account) return json({ error: 'account_not_found' }, 404);

  const requiredRow = await env.DB.prepare('SELECT * FROM exam_points_required WHERE exam_type = ?').bind(examType).first();
  if (!requiredRow) return json({ error: 'exam_type_not_redeemable' }, 400);
  if (account.points < requiredRow.points_required) return json({ error: 'insufficient_points' }, 402);

  await env.DB.prepare('UPDATE accounts SET points = points - ? WHERE id = ?')
    .bind(requiredRow.points_required, account.id).run();

  const { code, token } = await issueAndRedeemCode(env, examType, `points:${account.id}`);
  await detectAndCreditConversion(env, normalizedEmail);

  return json({ code, token, examType });
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

async function handleConsolePricingList(env) {
  const rows = (await env.DB.prepare('SELECT * FROM pricing').all()).results;
  return json({ pricing: rows });
}

async function handleConsolePricingSet(request, env) {
  const { examType, priceCents, currency } = await request.json();
  if (!examType || !priceCents) return json({ error: 'examType_and_priceCents_required' }, 400);
  await env.DB.prepare(
    `INSERT INTO pricing (exam_type, price_cents, currency, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (exam_type) DO UPDATE SET price_cents = excluded.price_cents, currency = excluded.currency, updated_at = excluded.updated_at`
  ).bind(examType, priceCents, currency || 'USD', now()).run();
  return json({ ok: true });
}

async function handleConsolePointRulesList(env) {
  const rows = (await env.DB.prepare('SELECT * FROM point_rules ORDER BY task_key').all()).results;
  return json({ pointRules: rows });
}

async function handleConsolePointRulesSet(request, env) {
  const { taskKey, label, points, active } = await request.json();
  if (!taskKey || !label || points == null) return json({ error: 'taskKey_label_points_required' }, 400);
  await env.DB.prepare(
    `INSERT INTO point_rules (task_key, label, points, active, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (task_key) DO UPDATE SET label = excluded.label, points = excluded.points, active = excluded.active, updated_at = excluded.updated_at`
  ).bind(taskKey, label, points, active ? 1 : 0, now()).run();
  return json({ ok: true });
}

async function handleConsoleExamPointsRequiredList(env) {
  const rows = (await env.DB.prepare('SELECT * FROM exam_points_required').all()).results;
  return json({ examPointsRequired: rows });
}

async function handleConsoleExamPointsRequiredSet(request, env) {
  const { examType, pointsRequired } = await request.json();
  if (!examType || pointsRequired == null) return json({ error: 'examType_and_pointsRequired_required' }, 400);
  await env.DB.prepare(
    `INSERT INTO exam_points_required (exam_type, points_required) VALUES (?, ?)
     ON CONFLICT (exam_type) DO UPDATE SET points_required = excluded.points_required`
  ).bind(examType, pointsRequired).run();
  return json({ ok: true });
}

async function handleConsoleAccountsList(env) {
  const rows = (await env.DB.prepare(
    `SELECT a.*,
       (SELECT COUNT(*) FROM referrals r WHERE r.referrer_account_id = a.id) AS referrals_sent,
       (SELECT COUNT(*) FROM referrals r WHERE r.referrer_account_id = a.id AND r.status IN ('verified','converted')) AS referrals_verified,
       (SELECT COUNT(*) FROM referrals r WHERE r.referrer_account_id = a.id AND r.status = 'converted') AS referrals_converted
     FROM accounts a ORDER BY a.points DESC LIMIT 500`
  ).all()).results;
  return json({ accounts: rows });
}

async function handleConsoleAccountsAdjustPoints(request, env) {
  const { email, delta, reason } = await request.json();
  if (!email || !delta || !reason) return json({ error: 'email_delta_reason_required' }, 400);
  const account = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email.trim().toLowerCase()).first();
  if (!account) return json({ error: 'account_not_found' }, 404);

  const adminEmail = getAccessEmail(request);
  await env.DB.batch([
    env.DB.prepare('UPDATE accounts SET points = points + ? WHERE id = ?').bind(delta, account.id),
    env.DB.prepare(
      'INSERT INTO point_adjustments (id, account_id, delta, reason, admin_email, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(newId(), account.id, delta, reason, adminEmail, now()),
  ]);
  return json({ ok: true, newBalance: account.points + delta });
}

async function handleConsoleReferralsList(env) {
  const rows = (await env.DB.prepare(
    `SELECT r.*, a.email AS referrer_email FROM referrals r
     JOIN accounts a ON a.id = r.referrer_account_id
     ORDER BY r.created_at DESC LIMIT 500`
  ).all()).results;
  return json({ referrals: rows });
}

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
    b.correctChoice, b.explanation, b.weight ?? 3, b.sourceNote || null, b.source || 'self-gen'];
}

async function handleQuestionCreate(request, env) {
  const b = await request.json();
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO questions (id, exam_type, topic, question, choice_a, choice_b, choice_c, choice_d,
       correct_choice, explanation, weight, source_note, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, ...questionFromBody(b), now()).run();
  return json({ id });
}

async function handleQuestionUpdate(request, env) {
  const b = await request.json();
  if (!b.id) return json({ error: 'id_required' }, 400);
  await env.DB.prepare(
    `UPDATE questions SET exam_type=?, topic=?, question=?, choice_a=?, choice_b=?, choice_c=?, choice_d=?,
       correct_choice=?, explanation=?, weight=?, source_note=?, source=? WHERE id = ?`
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
         correct_choice, explanation, weight, source_note, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      if (pathname === '/sample' && method === 'GET') return await handleSample(request, env);
      if (pathname === '/pricing' && method === 'GET') return await handlePricingGet(request, env);
      if (pathname === '/paypal/create-order' && method === 'POST') return await handlePaypalCreateOrder(request, env);
      if (pathname === '/paypal/capture-order' && method === 'POST') return await handlePaypalCaptureOrder(request, env);
      if (pathname === '/referrals/invite' && method === 'POST') return await handleReferralInvite(request, env);
      if (pathname === '/referrals/verify' && method === 'GET') return await handleReferralVerify(request, env);
      if (pathname === '/points/balance' && method === 'GET') return await handlePointsBalance(request, env);
      if (pathname === '/points/redeem' && method === 'POST') return await handlePointsRedeem(request, env);

      if (pathname.startsWith('/console/')) {
        if (!(await requireAccess(request, env))) return json({ error: 'unauthorized' }, 401);
        if (pathname === '/console/codes' && method === 'GET') return await handleCodesList(request, env);
        if (pathname === '/console/codes/generate' && method === 'POST') return await handleCodesGenerate(request, env);
        if (pathname === '/console/codes/revoke' && method === 'POST') return await handleCodesRevoke(request, env);
        if (pathname === '/console/pricing' && method === 'GET') return await handleConsolePricingList(env);
        if (pathname === '/console/pricing' && method === 'POST') return await handleConsolePricingSet(request, env);
        if (pathname === '/console/point-rules' && method === 'GET') return await handleConsolePointRulesList(env);
        if (pathname === '/console/point-rules' && method === 'POST') return await handleConsolePointRulesSet(request, env);
        if (pathname === '/console/exam-points-required' && method === 'GET') return await handleConsoleExamPointsRequiredList(env);
        if (pathname === '/console/exam-points-required' && method === 'POST') return await handleConsoleExamPointsRequiredSet(request, env);
        if (pathname === '/console/accounts' && method === 'GET') return await handleConsoleAccountsList(env);
        if (pathname === '/console/accounts/adjust-points' && method === 'POST') return await handleConsoleAccountsAdjustPoints(request, env);
        if (pathname === '/console/referrals' && method === 'GET') return await handleConsoleReferralsList(env);
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
