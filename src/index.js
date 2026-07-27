import { verifyTurnstile, requireUser, requireAccess, getAccessEmail, newId, newCode } from './lib/auth.js';
import { createPayPalOrder, capturePayPalOrder } from './lib/paypal.js';
import { sendCodeEmail, sendReferralInviteEmail, sendPointsEarnedEmail, sendRedeemVerifyEmail, sendAdminAlertEmail } from './lib/email.js';
import { signMediaUrl, verifyMediaSig } from './lib/mediaSign.js';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}
const now = () => Math.floor(Date.now() / 1000);

// Canonicalizes an email for referral dedup/self-referral checks -- major providers alias
// "+tag" suffixes (and Gmail additionally ignores dots in the local part) to the same inbox,
// so without this a single inbox can look like dozens of distinct referrals and farm points
// for free. Deliberately conservative: only known-aliasing domains are touched, so two
// genuinely different people elsewhere never collide.
const PLUS_ALIASING_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
]);
const DOT_INSENSITIVE_EMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
function normalizeEmailForDedup(email) {
  const trimmed = (email || '').trim().toLowerCase();
  const atIdx = trimmed.lastIndexOf('@');
  if (atIdx < 0) return trimmed;
  let local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  if (PLUS_ALIASING_EMAIL_DOMAINS.has(domain)) {
    const plusIdx = local.indexOf('+');
    if (plusIdx >= 0) local = local.slice(0, plusIdx);
  }
  if (DOT_INSENSITIVE_EMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

// Curated, non-exhaustive list of throwaway/disposable-inbox domains -- these let anyone mint
// unlimited genuinely-receivable addresses for free with no registration, which the alias
// normalization above can't catch (each one is a distinct, real domain). New disposable
// services appear constantly, so treat this as a meaningful deterrent, not a perfect wall.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'guerrillamail.biz',
  'guerrillamail.de', 'guerrillamail.org', 'guerrillamail.net', 'sharklasers.com', 'grr.la',
  'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmailo.com',
  '10minutemail.com', '10minutemail.net', 'throwawaymail.com', 'yopmail.com', 'yopmail.net',
  'yopmail.fr', 'trashmail.com', 'trashmail.net', 'dispostable.com', 'getnada.com',
  'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'mohmal.com', 'moakt.com', 'moakt.cc',
  'fakeinbox.com', 'spamgourmet.com', 'discard.email', 'mailcatch.com', 'tempinbox.com',
  'emailondeck.com', 'getairmail.com', 'burnermail.io', 'inboxbear.com', 'tempr.email',
  'mail-temp.com', 'correotemporal.org', 'luxusmail.org', 'wegwerfemail.de', 'einrot.com',
  'spambog.com', 'mytemp.email', 'emkei.cz', 'dropmail.me', 'fakemailgenerator.com',
]);
function isDisposableEmail(email) {
  const trimmed = (email || '').trim().toLowerCase();
  const atIdx = trimmed.lastIndexOf('@');
  if (atIdx < 0) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(trimmed.slice(atIdx + 1));
}

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

// Parses a `Range: bytes=start-end` header into an R2 { offset, length } range, supporting
// open-ended ("bytes=500-") and suffix ("bytes=-500") forms. Needed so <audio>/<video> can
// seek within these (often 50-100MB+) files instead of re-downloading the whole thing.
function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;
  let start = match[1] ? parseInt(match[1], 10) : null;
  let end = match[2] ? parseInt(match[2], 10) : null;
  if (start === null && end === null) return null;
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (start > end) return null;
  return { offset: start, length: end - start + 1 };
}

// Public (no bearer token — plain <audio>/<video>/<iframe> tags can't attach one), gated
// entirely by the exp/sig query params minted by /resources/sign-batch. This is the ONLY way
// to reach file contents once the R2 bucket's public custom domain is removed.
async function handleMediaFile(request, env) {
  const url = new URL(request.url);
  const file = decodeURIComponent(url.pathname.slice('/media/'.length));
  const exp = url.searchParams.get('exp');
  const sig = url.searchParams.get('sig');
  if (!(await verifyMediaSig(env, file, exp, sig))) return json({ error: 'invalid_or_expired' }, 403);

  const head = await env.MEDIA.head(file);
  if (!head) return json({ error: 'not_found' }, 404);

  const range = parseRange(request.headers.get('range'), head.size);
  const object = await env.MEDIA.get(file, range ? { range } : undefined);
  if (!object) return json({ error: 'not_found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, max-age=3600');

  if (range) {
    headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

// Bearer-token gated (see router) so only someone who has redeemed/bought a code can mint
// these; the handler itself doesn't need to read `user` since every exam-type's resources are
// available uniformly to anyone with a valid session, not per-account entitlements.
async function handleResourcesSignBatch(request, env) {
  const { files } = await request.json();
  if (!Array.isArray(files) || !files.length) return json({ error: 'files_required' }, 400);
  const ttlSeconds = 3600; // long enough to fully stream a large file, short enough to discourage link-sharing
  const urls = {};
  for (const file of files) {
    const { exp, sig } = await signMediaUrl(env, file, ttlSeconds);
    urls[file] = `/media/${encodeURIComponent(file)}?exp=${exp}&sig=${sig}`;
  }
  return json({ urls });
}

// Server-side source of truth for which resources are free-to-preview without an access code —
// deliberately NOT trusted from the client, so a visitor can't just edit a `free: true` flag in
// devtools to unlock everything. Must be kept in sync with the `free:` flags in the site's own
// RESOURCES data (site repo, wwwroot/js/app.js) — that copy is presentation-only.
const FREE_RESOURCES = {
  notary: [
    'California_Notary_Fees.mp4',
    'California_Notary_2026_Quick_Guide.png',
  ],
};

async function handleResourcesFree(request, env) {
  const url = new URL(request.url);
  const examType = url.searchParams.get('examType') || 'notary';
  const files = FREE_RESOURCES[examType] || [];
  const ttlSeconds = 3600;
  const urls = {};
  for (const file of files) {
    const { exp, sig } = await signMediaUrl(env, file, ttlSeconds);
    urls[file] = `/media/${encodeURIComponent(file)}?exp=${exp}&sig=${sig}`;
  }
  return json({ urls });
}

const DEFAULT_PRICE_CENTS = 499; // fallback if the `pricing` table has no row yet for an exam type
const DEFAULT_MIN_PAYPAL_CHARGE_CENTS = 100; // fallback if app_settings has no row yet

async function getPrice(env, examType) {
  const row = await env.DB.prepare('SELECT * FROM pricing WHERE exam_type = ?').bind(examType).first();
  return row ? { priceCents: row.price_cents, currency: row.currency } : { priceCents: DEFAULT_PRICE_CENTS, currency: 'USD' };
}

async function getAppSetting(env, key, fallback) {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}

// Fire-and-forget activity alert to the site owner -- no-op if admin_alert_email isn't set
// (examprep-admin's Settings tab), and never throws, so a missing/misconfigured recipient can
// never break the actual user-facing action it's reporting on.
async function notifyAdmin(env, title, bodyHtml) {
  try {
    const to = await getAppSetting(env, 'admin_alert_email', '');
    if (!to) return;
    await sendAdminAlertEmail(env, to, title, bodyHtml);
  } catch (e) { /* best-effort */ }
}

// A points discount can never leave a PayPal charge below this (admin-editable in
// examprep-admin's Settings tab) -- $0 (full coverage) is fine and skips PayPal entirely
// via /points/redeem, but a sub-floor partial charge isn't, so create-order caps the points
// applied instead of letting the leftover dip below it.
async function getMinPaypalChargeCents(env) {
  const value = await getAppSetting(env, 'min_paypal_charge_cents', String(DEFAULT_MIN_PAYPAL_CHARGE_CENTS));
  const cents = parseInt(value, 10);
  return Number.isFinite(cents) && cents >= 0 ? cents : DEFAULT_MIN_PAYPAL_CHARGE_CENTS;
}

async function handlePricingGet(request, env) {
  const url = new URL(request.url);
  const examType = url.searchParams.get('examType') || 'notary';
  const { priceCents, currency } = await getPrice(env, examType);
  const minPaypalChargeCents = await getMinPaypalChargeCents(env);
  return json({ examType, priceCents, currency, minPaypalChargeCents });
}

// Shared by /paypal/capture-order and (later) /points/redeem — generates a fresh code and
// immediately auto-redeems it (mint token + create user + flip code to redeemed), mirroring
// /redeem's unused-code branch, so the buyer never has to separately type their own code in.
async function issueAndRedeemCode(env, examType, note, paidCents, buyerEmail) {
  const code = newCode();
  const token = crypto.randomUUID();
  const userId = newId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO codes (code, exam_type, note, issued_at, paid_cents, buyer_email) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(code, examType, note, now(), paidCents == null ? null : paidCents, buyerEmail || null),
    env.DB.prepare('INSERT INTO users (id, exam_type, token, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, examType, token, now(), now()),
    env.DB.prepare("UPDATE codes SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE code = ?")
      .bind(userId, now(), code),
  ]);
  return { code, token };
}

async function handlePaypalCreateOrder(request, env) {
  const { examType, turnstileToken, email, applyPoints } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!examType) return json({ error: 'examType_required' }, 400);

  const { priceCents, currency } = await getPrice(env, examType);

  // Points are only ever quoted here, never deducted -- that only happens once a capture
  // actually succeeds (see handlePaypalCaptureOrder), so an abandoned checkout costs nothing.
  let finalPriceCents = priceCents;
  let pointsToApply = 0;
  if (applyPoints && email) {
    const account = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email.trim().toLowerCase()).first();
    if (account && account.points > 0) {
      pointsToApply = Math.min(account.points, priceCents);
      if (pointsToApply >= priceCents) {
        return json({ error: 'fully_covered_by_points' }, 400); // client should use /points/redeem instead
      }
      // A partial discount can't leave less than the admin-set floor payable through PayPal --
      // cap the points actually applied so the leftover doesn't dip below it (unapplied points
      // just stay in the account for next time, nothing is lost).
      const minPaypalChargeCents = await getMinPaypalChargeCents(env);
      if (priceCents - pointsToApply < minPaypalChargeCents) {
        pointsToApply = Math.max(0, priceCents - minPaypalChargeCents);
      }
      finalPriceCents = priceCents - pointsToApply;
    }
  }

  const order = await createPayPalOrder(env, finalPriceCents, currency);

  if (pointsToApply > 0) {
    await env.DB.prepare(
      'INSERT INTO pending_point_discounts (order_id, email, points_to_apply, created_at) VALUES (?, ?, ?, ?)'
    ).bind(order.id, email.trim().toLowerCase(), pointsToApply, now()).run();
  }

  return json({ orderId: order.id, priceCents: finalPriceCents, pointsApplied: pointsToApply });
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

  const { priceCents: fullPriceCents } = await getPrice(env, examType);
  const discount = await env.DB.prepare('SELECT * FROM pending_point_discounts WHERE order_id = ?').bind(orderId).first();
  const expectedCents = discount ? fullPriceCents - discount.points_to_apply : fullPriceCents;

  const capture = await capturePayPalOrder(env, orderId);
  if (capture.status !== 'COMPLETED') return json({ error: 'payment_not_completed' }, 402);

  const captured = capture.purchase_units && capture.purchase_units[0] &&
    capture.purchase_units[0].payments && capture.purchase_units[0].payments.captures &&
    capture.purchase_units[0].payments.captures[0];
  const capturedCents = captured ? Math.round(parseFloat(captured.amount.value) * 100) : 0;
  if (capturedCents !== expectedCents) return json({ error: 'amount_mismatch' }, 402);

  // PayPal's own capture response tells us the payer's email for free -- no extra field/friction
  // needed on the buy form to detect "this buyer was someone's referral" or to record who paid.
  const payerEmail = capture.payer && capture.payer.email_address;
  const { code, token } = await issueAndRedeemCode(env, examType, note, capturedCents, payerEmail || email);

  if (discount) {
    // MAX(0, ...) floors it defensively in case the balance somehow changed since create-order
    // (e.g. another purchase in a different tab) — the buyer already got the discount they paid
    // for either way, so we don't fail the purchase over a stale points snapshot.
    await env.DB.prepare('UPDATE accounts SET points = MAX(0, points - ?) WHERE email = ?')
      .bind(discount.points_to_apply, discount.email).run();
    await env.DB.prepare('DELETE FROM pending_point_discounts WHERE order_id = ?').bind(orderId).run();
  }

  if (email) {
    try { await sendCodeEmail(env, email, code, examType); } catch (e) { /* best-effort, buyer already has the code on-screen */ }
  }

  await detectAndCreditConversion(env, payerEmail);
  await notifyAdmin(env, 'New purchase',
    `<p><strong>${payerEmail || email || 'A buyer'}</strong> just bought ${examType} access for ` +
    `$${(capturedCents / 100).toFixed(2)}` + (discount ? ` (${discount.points_to_apply} points applied as a discount)` : '') + `.</p>`);

  return json({ code, token, examType, pointsApplied: discount ? discount.points_to_apply : 0 });
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

// Accepts a batch of friends in one call rather than one-friend-per-request -- Turnstile tokens
// are single-use, so referring several friends at once genuinely needs to be one request, not
// the client calling this N times with the same token. Partial success is expected/normal (e.g.
// one friend in the batch was already referred by someone else) -- reported per-friend rather
// than failing the whole batch over one bad entry.
async function handleReferralInvite(request, env) {
  const { referrerEmail, referrerName, friends, turnstileToken } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!referrerEmail || !Array.isArray(friends) || !friends.length) {
    return json({ error: 'referrerEmail_and_friends_required' }, 400);
  }
  const referrerEmailNorm = referrerEmail.trim().toLowerCase();
  if (isDisposableEmail(referrerEmailNorm)) {
    return json({ error: 'disposable_email' }, 400);
  }
  const referrer = await getOrCreateAccount(env, referrerEmailNorm, referrerName);

  // Rate limit: protects Resend sending-domain reputation from spam-blast abuse. Whole batch is
  // rejected up front if it would push the referrer over the daily cap, rather than partially
  // processing it and leaving them guessing which ones went through.
  const dayAgo = now() - 86400;
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM referrals WHERE referrer_account_id = ? AND created_at > ?'
  ).bind(referrer.id, dayAgo).first();
  if (recent.n + friends.length > 20) {
    return json({ error: 'rate_limited', remainingToday: Math.max(0, 20 - recent.n) }, 429);
  }

  const results = [];
  for (const friend of friends) {
    const friendEmail = (friend && friend.email ? friend.email : '').trim().toLowerCase();
    const friendName = friend && friend.name ? friend.name : null;
    if (!friendEmail) { results.push({ email: friend && friend.email || '', status: 'invalid' }); continue; }
    if (isDisposableEmail(friendEmail)) { results.push({ email: friendEmail, status: 'disposable_email' }); continue; }
    const friendEmailNormalized = normalizeEmailForDedup(friendEmail);
    if (friendEmailNormalized === normalizeEmailForDedup(referrerEmailNorm)) {
      results.push({ email: friendEmail, status: 'self' });
      continue;
    }

    const verifyToken = crypto.randomUUID();
    try {
      await env.DB.prepare(
        'INSERT INTO referrals (id, referrer_account_id, referred_email, referred_email_normalized, referred_name, verify_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(newId(), referrer.id, friendEmail, friendEmailNormalized, friendName, verifyToken, now()).run();
    } catch (e) {
      results.push({ email: friendEmail, status: 'already_referred' }); // UNIQUE constraint on referred_email_normalized
      continue;
    }

    try {
      const verifyUrl = `https://examprep.softician.com/notary#/refer-verify/${verifyToken}`;
      await sendReferralInviteEmail(env, friendEmail, referrerName, verifyUrl);
    } catch (e) { /* referral row still exists even if the invite email fails to send */ }
    results.push({ email: friendEmail, status: 'sent' });
  }

  return json({ results });
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
  const referrer = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(referral.referrer_account_id).first();
  if (pointsAwarded > 0 && referrer) {
    try { await sendPointsEarnedEmail(env, referrer.email, pointsAwarded, 'a friend confirmed your referral'); } catch (e) {}
  }
  await notifyAdmin(env, 'Referral confirmed',
    `<p><strong>${referrer ? referrer.email : 'Someone'}</strong>'s referral of <strong>${referral.referred_email}</strong> was just confirmed` +
    (pointsAwarded > 0 ? ` — they earned ${pointsAwarded} points.</p>` : '.</p>'));

  return json({ ok: true, alreadyVerified: false });
}

// Shared by /paypal/capture-order and /points/redeem — best-effort, never throws, so a
// purchase/redemption never fails just because this bookkeeping step hit a snag.
async function detectAndCreditConversion(env, buyerEmail) {
  if (!buyerEmail) return;
  try {
    const emailNormalized = normalizeEmailForDedup(buyerEmail);
    const referral = await env.DB.prepare(
      "SELECT * FROM referrals WHERE referred_email_normalized = ? AND status = 'verified' AND converted_at IS NULL"
    ).bind(emailNormalized).first();
    if (!referral) return;

    await env.DB.prepare("UPDATE referrals SET status = 'converted', converted_at = ? WHERE id = ?")
      .bind(now(), referral.id).run();

    const pointsAwarded = await awardPoints(env, referral.referrer_account_id, 'referral_converted');
    const referrer = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(referral.referrer_account_id).first();
    if (pointsAwarded > 0 && referrer) {
      await sendPointsEarnedEmail(env, referrer.email, pointsAwarded, 'your referral signed up for a course');
    }
    await notifyAdmin(env, 'Referral converted',
      `<p><strong>${referrer ? referrer.email : 'Someone'}</strong>'s referral <strong>${referral.referred_email}</strong> just signed up for a course` +
      (pointsAwarded > 0 ? ` — they earned ${pointsAwarded} points.</p>` : '.</p>'));
  } catch (e) { /* best-effort */ }
}

// ---- Purchase refund guarantees ----------------------------------------
// Two claim types, both computed off codes.paid_cents (real cash) so a free/points-redeemed
// code is never eligible: unconditional_7day (full refund, no reason needed, within 7 days of
// purchase) and exam_failure_50pct (half refund if the buyer took and failed the real exam,
// within a 180-day soft window). Neither is verified automatically -- there's no official way
// to confirm a real exam result -- so every claim lands in an admin review queue instead of
// being auto-approved, and actual refund execution happens manually in PayPal, not via API here.
const REFUND_UNCONDITIONAL_WINDOW_SEC = 7 * 86400;
const REFUND_FAILURE_WINDOW_SEC = 180 * 86400;
const REFUND_FAILURE_PERCENT = 0.5;

async function handleRefundClaimSubmit(request, env) {
  const { code, email, claimType, examDate, confirmationNote, notes, turnstileToken } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!code || !email || !claimType) return json({ error: 'code_email_claimType_required' }, 400);
  if (claimType !== 'unconditional_7day' && claimType !== 'exam_failure_50pct') {
    return json({ error: 'invalid_claim_type' }, 400);
  }

  const codeRow = await env.DB.prepare('SELECT * FROM codes WHERE code = ?').bind(code.trim().toUpperCase()).first();
  if (!codeRow) return json({ error: 'code_not_found' }, 404);
  // note starts with 'paypal:' only for real self-serve purchases -- free/points-redeemed and
  // admin-issued codes never have a paid_cents value, so they're never refund-eligible.
  if (!codeRow.note || !codeRow.note.startsWith('paypal:') || !codeRow.paid_cents) {
    return json({ error: 'not_a_paid_purchase' }, 400);
  }

  const existingClaim = await env.DB.prepare('SELECT id FROM refund_claims WHERE code = ?').bind(codeRow.code).first();
  if (existingClaim) return json({ error: 'already_claimed' }, 400);

  const windowSec = claimType === 'unconditional_7day' ? REFUND_UNCONDITIONAL_WINDOW_SEC : REFUND_FAILURE_WINDOW_SEC;
  if (now() - codeRow.issued_at > windowSec) return json({ error: 'window_expired' }, 400);

  const refundCents = claimType === 'unconditional_7day'
    ? codeRow.paid_cents
    : Math.round(codeRow.paid_cents * REFUND_FAILURE_PERCENT);

  const claimId = newId();
  await env.DB.prepare(
    `INSERT INTO refund_claims (id, code, email, claim_type, status, exam_date, confirmation_note, notes, refund_cents, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
  ).bind(claimId, codeRow.code, email.trim().toLowerCase(), claimType, examDate || null, confirmationNote || null, notes || null, refundCents, now()).run();

  await notifyAdmin(env, 'New refund claim',
    `<p>${claimType === 'unconditional_7day' ? '7-day no-questions' : 'exam-failure 50%'} refund claim for code ` +
    `<strong>${codeRow.code}</strong> (${email}) — $${(refundCents / 100).toFixed(2)}. Review it in the admin Refund Claims tab.</p>`);

  return json({ ok: true, refundCents });
}

async function handleConsoleRefundClaimsList(env) {
  const rows = (await env.DB.prepare('SELECT * FROM refund_claims ORDER BY created_at DESC LIMIT 500').all()).results;
  return json({ claims: rows });
}

async function handleConsoleRefundClaimsReview(request, env) {
  const { claimId, status, adminNotes } = await request.json();
  if (!claimId || !['approved', 'denied', 'refunded'].includes(status)) {
    return json({ error: 'claimId_and_valid_status_required' }, 400);
  }
  const claim = await env.DB.prepare('SELECT * FROM refund_claims WHERE id = ?').bind(claimId).first();
  if (!claim) return json({ error: 'claim_not_found' }, 404);

  const adminEmail = getAccessEmail(request);
  await env.DB.prepare('UPDATE refund_claims SET status = ?, admin_notes = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?')
    .bind(status, adminNotes || null, now(), adminEmail || null, claimId).run();

  // A full (7-day) refund also revokes the code -- the buyer no longer has paid access once
  // they've gotten their money back. A half refund (exam failure) leaves access intact, since
  // the buyer already used and paid for what they're keeping.
  if (status === 'refunded' && claim.claim_type === 'unconditional_7day') {
    await env.DB.prepare("UPDATE codes SET status = 'revoked' WHERE code = ?").bind(claim.code).run();
  }

  return json({ ok: true });
}

// Public (unauthenticated) view of what each referral task currently earns -- lets the site's
// refer page show real, live numbers instead of hardcoded copy that drifts out of sync with
// whatever an admin has actually configured in Settings.
async function handlePointsRules(env) {
  const rows = (await env.DB.prepare('SELECT task_key, points FROM point_rules WHERE active = 1').all()).results;
  const byKey = {};
  rows.forEach((r) => { byKey[r.task_key] = r.points; });
  return json({
    referralVerifiedPoints: byKey.referral_verified || 0,
    referralConvertedPoints: byKey.referral_converted || 0,
  });
}

async function handlePointsBalance(request, env) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return json({ error: 'email_required' }, 400);
  const account = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
  // 1 point = 1 cent, so the redemption threshold is just the course's price — always in sync
  // with whatever the admin sets it to, no separate "points required" value to keep updated.
  const rows = (await env.DB.prepare('SELECT * FROM pricing').all()).results;
  return json({
    points: account ? account.points : 0,
    examTypes: rows.map((r) => ({ examType: r.exam_type, pointsRequired: r.price_cents })),
  });
}

const REDEEM_VERIFY_TTL_SECONDS = 1800; // 30 minutes to click the confirmation email

// Doesn't redeem anything yet -- only knowing/guessing someone's email shouldn't be enough to
// spend their points, so this just emails a one-time confirmation link (mirrors referral
// verification) and the actual redemption happens in handlePointsRedeemVerify once it's clicked.
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

  const { priceCents: required } = await getPrice(env, examType); // 1 point = 1 cent
  if (account.points < required) return json({ error: 'insufficient_points' }, 402);

  const verifyToken = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO pending_redemptions (id, email, exam_type, points, verify_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(newId(), normalizedEmail, examType, required, verifyToken, now(), now() + REDEEM_VERIFY_TTL_SECONDS).run();

  const verifyUrl = `https://examprep.softician.com/notary#/points-redeem-verify/${verifyToken}`;
  await sendRedeemVerifyEmail(env, normalizedEmail, required, verifyUrl);

  return json({ pending: true, email: normalizedEmail });
}

async function handlePointsRedeemVerify(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'token_required' }, 400);

  // Atomically claim (delete) the pending row -- a concurrent or repeat click on the same link
  // finds nothing and fails cleanly, instead of racing another request to redeem twice.
  const pending = await env.DB.prepare(
    'DELETE FROM pending_redemptions WHERE verify_token = ? AND expires_at > ? RETURNING *'
  ).bind(token, now()).first();
  if (!pending) return json({ error: 'invalid_or_expired' }, 404);

  const account = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(pending.email).first();
  if (!account) return json({ error: 'account_not_found' }, 404);

  // Conditional on points still being sufficient -- closes the same TOCTOU window a plain
  // check-then-write would leave open, and guards against the balance having moved (e.g. spent
  // elsewhere) in the time between requesting and confirming the redemption.
  const deduction = await env.DB.prepare(
    'UPDATE accounts SET points = points - ? WHERE id = ? AND points >= ?'
  ).bind(pending.points, account.id, pending.points).run();
  if (!deduction.meta || deduction.meta.changes === 0) return json({ error: 'insufficient_points' }, 402);

  const { code, token: sessionToken } = await issueAndRedeemCode(env, pending.exam_type, `points:${account.id}`, 0, pending.email);
  await detectAndCreditConversion(env, pending.email);
  await notifyAdmin(env, 'Points redeemed',
    `<p><strong>${pending.email}</strong> redeemed <strong>${pending.points} points</strong> for free access to the ${pending.exam_type} course.</p>`);

  return json({ code, token: sessionToken, examType: pending.exam_type });
}

// Difficulty is never manually tagged -- it's derived from how everyone (not just the current
// user) has actually done on each question, via the same `progress` table already used for
// spaced review. A question needs a minimum sample size before its computed accuracy is trusted;
// below that it defaults to 'moderate' rather than guessing from an unrelated field.
const DIFFICULTY_MIN_SAMPLES = 5;
const DIFFICULTY_BANDS = ['easy', 'moderate', 'hard', 'extremely_hard'];
const DIFFICULTY_CTE = `WITH q_stats AS (
    SELECT question_id, SUM(times_seen) AS seen, SUM(times_correct) AS correct FROM progress GROUP BY question_id
  ) `;
const DIFFICULTY_CASE = `CASE
    WHEN COALESCE(qs.seen, 0) < ${DIFFICULTY_MIN_SAMPLES} THEN 'moderate'
    WHEN (CAST(qs.correct AS REAL) / qs.seen) >= 0.8 THEN 'easy'
    WHEN (CAST(qs.correct AS REAL) / qs.seen) >= 0.6 THEN 'moderate'
    WHEN (CAST(qs.correct AS REAL) / qs.seen) >= 0.4 THEN 'hard'
    ELSE 'extremely_hard'
  END`;

async function findNextQuestionRow(env, user, difficulty) {
  const cte = difficulty ? DIFFICULTY_CTE : '';
  const diffJoin = difficulty ? 'LEFT JOIN q_stats qs ON qs.question_id = q.id' : '';
  const diffFilter = difficulty ? `AND (${DIFFICULTY_CASE}) = ?` : '';
  const diffArgs = difficulty ? [difficulty] : [];

  const unseen = await env.DB.prepare(
    `${cte}SELECT q.* FROM questions q LEFT JOIN progress p ON p.question_id = q.id AND p.user_id = ? ${diffJoin}
     WHERE q.exam_type = ? AND p.question_id IS NULL ${diffFilter} ORDER BY q.weight DESC, RANDOM() LIMIT 1`
  ).bind(user.id, user.exam_type, ...diffArgs).first();
  if (unseen) return unseen;

  const missed = await env.DB.prepare(
    `${cte}SELECT q.* FROM questions q JOIN progress p ON p.question_id = q.id ${diffJoin}
     WHERE p.user_id = ? AND p.last_result = 'incorrect' ${diffFilter} ORDER BY RANDOM() LIMIT 1`
  ).bind(user.id, ...diffArgs).first();
  if (missed) return missed;

  const review = await env.DB.prepare(
    `${cte}SELECT q.* FROM questions q JOIN progress p ON p.question_id = q.id ${diffJoin}
     WHERE p.user_id = ? ${diffFilter} ORDER BY RANDOM() LIMIT 1`
  ).bind(user.id, ...diffArgs).first();
  return review || null;
}

async function handleNextQuestion(user, env, difficulty) {
  const validDifficulty = difficulty && DIFFICULTY_BANDS.includes(difficulty) ? difficulty : null;
  let row = await findNextQuestionRow(env, user, validDifficulty);
  // If that band has nothing left (e.g. all extremely_hard questions already seen), fall back to
  // the unfiltered pick rather than dead-ending the quiz.
  if (!row && validDifficulty) row = await findNextQuestionRow(env, user, null);
  if (row) return json(toPublicQuestion(row));
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

// ---- Resource consumption tracking -------------------------------------
// Best-effort, per-user record of what study resources have been opened and (for audio/video)
// how much of them was actually watched/listened to -- surfaced back to the user on their own
// Resources tab, and to the admin per-user across the whole library.

async function handleResourceProgressUpdate(user, request, env) {
  const { file, type, percent, isNewOpen } = await request.json();
  if (!file || !type) return json({ error: 'file_and_type_required' }, 400);
  const clamped = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const nowTs = now();
  // isNewOpen fires once when a resource is expanded/opened -- periodic playback-progress
  // updates during that same session must NOT also increment times_opened.
  const openIncrement = isNewOpen ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO resource_progress (user_id, resource_file, resource_type, percent, times_opened, first_opened_at, last_opened_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (user_id, resource_file) DO UPDATE SET
       percent = MAX(resource_progress.percent, excluded.percent),
       times_opened = resource_progress.times_opened + ?,
       last_opened_at = excluded.last_opened_at`
  ).bind(user.id, file, type, clamped, nowTs, nowTs, openIncrement).run();
  return json({ ok: true });
}

async function handleResourceProgressGet(user, env) {
  const rows = (await env.DB.prepare(
    'SELECT resource_file, resource_type, percent, times_opened, last_opened_at FROM resource_progress WHERE user_id = ?'
  ).bind(user.id).all()).results;
  return json({ items: rows });
}

// ---- Mock exam attempts (admin visibility) ------------------------------

async function handleConsoleExamAttemptsList(env) {
  const rows = (await env.DB.prepare(
    `SELECT ea.id, ea.exam_type, ea.score_correct, ea.score_total, ea.started_at, ea.submitted_at,
            c.code, c.buyer_email
     FROM exam_attempts ea
     JOIN users u ON u.id = ea.user_id
     LEFT JOIN codes c ON c.redeemed_by = u.id
     WHERE ea.submitted_at IS NOT NULL
     ORDER BY ea.submitted_at DESC LIMIT 1000`
  ).all()).results;
  return json({
    items: rows.map((r) => {
      const config = getExamConfig(r.exam_type);
      const percent = r.score_total ? Math.round((r.score_correct / r.score_total) * 1000) / 10 : 0;
      return {
        attemptId: r.id, examType: r.exam_type, code: r.code, buyerEmail: r.buyer_email,
        correct: r.score_correct, total: r.score_total, percent, passed: percent >= config.passPercent,
        startedAt: r.started_at, submittedAt: r.submitted_at,
      };
    }),
  });
}

async function handleConsoleResourceProgressList(env) {
  const rows = (await env.DB.prepare(
    `SELECT rp.*, u.exam_type, c.code, c.buyer_email FROM resource_progress rp
     JOIN users u ON u.id = rp.user_id
     LEFT JOIN codes c ON c.redeemed_by = u.id
     ORDER BY rp.last_opened_at DESC LIMIT 1000`
  ).all()).results;
  return json({ items: rows });
}

// ---- Timed mock exam --------------------------------------------------
// A single-sitting, timed simulation of the real exam -- fixed question set + a
// server-authoritative start time (not client-trusted) so refreshing or fiddling with the
// client clock can't extend the time limit or draw a fresh, easier question set mid-attempt.

const EXAM_CONFIGS = {
  // 45 questions / 60 minutes / scaled score of 70 to pass, per CPS HR's official exam FAQ.
  // The real score is a proprietary scaled score (0-100), not literally percent-correct --
  // this uses raw percent-correct against the same 70 threshold as a practice approximation.
  notary: { questionCount: 45, durationSec: 3600, passPercent: 70 },
};
function getExamConfig(examType) {
  return EXAM_CONFIGS[examType] || { questionCount: 45, durationSec: 3600, passPercent: 70 };
}

async function handleExamConfig(request, env) {
  const url = new URL(request.url);
  const examType = url.searchParams.get('examType') || 'notary';
  return json({ examType, ...getExamConfig(examType) });
}

async function fetchQuestionsByIds(env, questionIds) {
  if (!questionIds.length) return {};
  const rows = (await env.DB.prepare(
    `SELECT * FROM questions WHERE id IN (${questionIds.map(() => '?').join(',')})`
  ).bind(...questionIds).all()).results;
  const byId = {};
  rows.forEach((r) => { byId[r.id] = r; });
  return byId;
}

async function attemptToClientShape(env, attempt) {
  const questionIds = JSON.parse(attempt.question_ids);
  const byId = await fetchQuestionsByIds(env, questionIds);
  return {
    attemptId: attempt.id, examType: attempt.exam_type,
    questions: questionIds.map((id) => byId[id]).filter(Boolean).map(toPublicQuestion),
    answers: JSON.parse(attempt.answers), durationSec: attempt.duration_sec, startedAt: attempt.started_at,
  };
}

function buildExamResult(examType, questionIds, answers, byId, correct, total, startedAt, submittedAt, durationSec) {
  const config = getExamConfig(examType);
  const percent = total ? Math.round((correct / total) * 1000) / 10 : 0;
  return {
    correct, total, percent, passed: percent >= config.passPercent,
    timeTakenSec: Math.min(submittedAt - startedAt, durationSec),
    review: questionIds.map((id) => {
      const q = byId[id];
      if (!q) return null;
      return {
        questionId: id, topic: q.topic, question: q.question,
        choices: { A: q.choice_a, B: q.choice_b, C: q.choice_c, D: q.choice_d },
        yourChoice: answers[id] || null, correctChoice: q.correct_choice,
        correct: answers[id] === q.correct_choice, explanation: q.explanation,
      };
    }).filter(Boolean),
  };
}

async function findInProgressAttempt(user, env) {
  const existing = await env.DB.prepare(
    `SELECT * FROM exam_attempts WHERE user_id = ? AND exam_type = ? AND submitted_at IS NULL
     ORDER BY started_at DESC LIMIT 1`
  ).bind(user.id, user.exam_type).first();
  if (!existing || existing.started_at + existing.duration_sec <= now()) return null;
  return existing;
}

async function handleExamCurrent(user, env) {
  const attempt = await findInProgressAttempt(user, env);
  return json({ attempt: attempt ? await attemptToClientShape(env, attempt) : null });
}

async function handleExamStart(user, env) {
  // Resume rather than restart -- a refresh or re-visit mid-sitting must not hand out a
  // fresh, easier random question set or reset the clock.
  const existing = await findInProgressAttempt(user, env);
  if (existing) return json(await attemptToClientShape(env, existing));

  const config = getExamConfig(user.exam_type);
  const picked = (await env.DB.prepare(
    'SELECT id FROM questions WHERE exam_type = ? ORDER BY RANDOM() LIMIT ?'
  ).bind(user.exam_type, config.questionCount).all()).results;
  if (!picked.length) return json({ error: 'no_questions' }, 404);

  const attempt = {
    id: newId(), question_ids: JSON.stringify(picked.map((r) => r.id)), answers: '{}',
    duration_sec: config.durationSec, started_at: now(),
  };
  await env.DB.prepare(
    `INSERT INTO exam_attempts (id, user_id, exam_type, question_ids, answers, duration_sec, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(attempt.id, user.id, user.exam_type, attempt.question_ids, attempt.answers, attempt.duration_sec, attempt.started_at).run();

  return json(await attemptToClientShape(env, { ...attempt, user_id: user.id, exam_type: user.exam_type }));
}

async function handleExamAnswer(user, request, env) {
  const { attemptId, questionId, choice } = await request.json();
  const attempt = await env.DB.prepare('SELECT * FROM exam_attempts WHERE id = ? AND user_id = ?').bind(attemptId, user.id).first();
  if (!attempt) return json({ error: 'attempt_not_found' }, 404);
  if (attempt.submitted_at) return json({ error: 'already_submitted' }, 400);
  if (attempt.started_at + attempt.duration_sec <= now()) return json({ error: 'time_expired' }, 400);

  const answers = JSON.parse(attempt.answers);
  answers[questionId] = choice;
  await env.DB.prepare('UPDATE exam_attempts SET answers = ? WHERE id = ?').bind(JSON.stringify(answers), attemptId).run();
  return json({ ok: true });
}

async function handleExamSubmit(user, request, env) {
  const { attemptId } = await request.json();
  const attempt = await env.DB.prepare('SELECT * FROM exam_attempts WHERE id = ? AND user_id = ?').bind(attemptId, user.id).first();
  if (!attempt) return json({ error: 'attempt_not_found' }, 404);

  const questionIds = JSON.parse(attempt.question_ids);
  const answers = JSON.parse(attempt.answers);
  const byId = await fetchQuestionsByIds(env, questionIds);

  if (attempt.submitted_at) {
    // Idempotent -- a retried submit (e.g. flaky network) returns the same already-computed
    // result instead of erroring or rescoring.
    return json(buildExamResult(attempt.exam_type, questionIds, answers, byId,
      attempt.score_correct, attempt.score_total, attempt.started_at, attempt.submitted_at, attempt.duration_sec));
  }

  let correctCount = 0;
  questionIds.forEach((id) => { if (byId[id] && answers[id] === byId[id].correct_choice) correctCount++; });
  const submittedAt = now();
  await env.DB.prepare(
    'UPDATE exam_attempts SET submitted_at = ?, score_correct = ?, score_total = ? WHERE id = ?'
  ).bind(submittedAt, correctCount, questionIds.length, attemptId).run();

  const result = buildExamResult(attempt.exam_type, questionIds, answers, byId,
    correctCount, questionIds.length, attempt.started_at, submittedAt, attempt.duration_sec);

  const codeRow = await env.DB.prepare('SELECT code, buyer_email FROM codes WHERE redeemed_by = ?').bind(user.id).first();
  await notifyAdmin(env, 'Mock exam completed',
    `<p><strong>${(codeRow && (codeRow.buyer_email || codeRow.code)) || 'A user'}</strong> completed a ${attempt.exam_type} ` +
    `mock exam: ${correctCount}/${questionIds.length} (${result.percent}%) — ${result.passed ? 'passed' : 'did not pass'}.</p>`);

  return json(result);
}

// Every submitted attempt (question set, answers, score) is already persisted in exam_attempts --
// this just surfaces it so a user can browse past sittings and revisit what they got wrong,
// reusing the same review shape buildExamResult already produces for a just-submitted exam.
async function handleExamHistory(user, env) {
  const rows = (await env.DB.prepare(
    `SELECT id, exam_type, score_correct, score_total, started_at, submitted_at FROM exam_attempts
     WHERE user_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 50`
  ).bind(user.id).all()).results;
  return json({
    attempts: rows.map((r) => {
      const config = getExamConfig(r.exam_type);
      const percent = r.score_total ? Math.round((r.score_correct / r.score_total) * 1000) / 10 : 0;
      return {
        attemptId: r.id, examType: r.exam_type, correct: r.score_correct, total: r.score_total,
        percent, passed: percent >= config.passPercent, startedAt: r.started_at, submittedAt: r.submitted_at,
      };
    }),
  });
}

async function handleExamAttemptDetail(user, request, env) {
  const url = new URL(request.url);
  const attemptId = url.searchParams.get('attemptId');
  const attempt = attemptId
    ? await env.DB.prepare('SELECT * FROM exam_attempts WHERE id = ? AND user_id = ?').bind(attemptId, user.id).first()
    : null;
  if (!attempt || !attempt.submitted_at) return json({ error: 'attempt_not_found' }, 404);

  const questionIds = JSON.parse(attempt.question_ids);
  const answers = JSON.parse(attempt.answers);
  const byId = await fetchQuestionsByIds(env, questionIds);
  const result = buildExamResult(attempt.exam_type, questionIds, answers, byId,
    attempt.score_correct, attempt.score_total, attempt.started_at, attempt.submitted_at, attempt.duration_sec);
  return json({ ...result, startedAt: attempt.started_at, submittedAt: attempt.submitted_at });
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

async function handleConsoleSettingsList(env) {
  const rows = (await env.DB.prepare('SELECT * FROM app_settings').all()).results;
  return json({ settings: rows });
}

async function handleConsoleSettingsSet(request, env) {
  const { key, value } = await request.json();
  if (!key || value == null) return json({ error: 'key_and_value_required' }, 400);
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, String(value), now()).run();
  return json({ ok: true });
}

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
    `SELECT r.*, a.email AS referrer_email, a.name AS referrer_name FROM referrals r
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
      if (pathname === '/refunds/claim' && method === 'POST') return await handleRefundClaimSubmit(request, env);
      if (pathname === '/points/rules' && method === 'GET') return await handlePointsRules(env);
      if (pathname === '/points/balance' && method === 'GET') return await handlePointsBalance(request, env);
      if (pathname === '/points/redeem' && method === 'POST') return await handlePointsRedeem(request, env);
      if (pathname === '/points/redeem-verify' && method === 'GET') return await handlePointsRedeemVerify(request, env);
      if (pathname.startsWith('/media/') && method === 'GET') return await handleMediaFile(request, env);
      if (pathname === '/resources/free' && method === 'GET') return await handleResourcesFree(request, env);

      if (pathname.startsWith('/console/')) {
        if (!(await requireAccess(request, env))) return json({ error: 'unauthorized' }, 401);
        if (pathname === '/console/codes' && method === 'GET') return await handleCodesList(request, env);
        if (pathname === '/console/codes/generate' && method === 'POST') return await handleCodesGenerate(request, env);
        if (pathname === '/console/codes/revoke' && method === 'POST') return await handleCodesRevoke(request, env);
        if (pathname === '/console/pricing' && method === 'GET') return await handleConsolePricingList(env);
        if (pathname === '/console/pricing' && method === 'POST') return await handleConsolePricingSet(request, env);
        if (pathname === '/console/settings' && method === 'GET') return await handleConsoleSettingsList(env);
        if (pathname === '/console/settings' && method === 'POST') return await handleConsoleSettingsSet(request, env);
        if (pathname === '/console/point-rules' && method === 'GET') return await handleConsolePointRulesList(env);
        if (pathname === '/console/point-rules' && method === 'POST') return await handleConsolePointRulesSet(request, env);
        if (pathname === '/console/accounts' && method === 'GET') return await handleConsoleAccountsList(env);
        if (pathname === '/console/accounts/adjust-points' && method === 'POST') return await handleConsoleAccountsAdjustPoints(request, env);
        if (pathname === '/console/referrals' && method === 'GET') return await handleConsoleReferralsList(env);
        if (pathname === '/console/refund-claims' && method === 'GET') return await handleConsoleRefundClaimsList(env);
        if (pathname === '/console/refund-claims/review' && method === 'POST') return await handleConsoleRefundClaimsReview(request, env);
        if (pathname === '/console/questions' && method === 'GET') return await handleQuestionsList(request, env);
        if (pathname === '/console/questions/create' && method === 'POST') return await handleQuestionCreate(request, env);
        if (pathname === '/console/questions/update' && method === 'POST') return await handleQuestionUpdate(request, env);
        if (pathname === '/console/questions/delete' && method === 'POST') return await handleQuestionDelete(request, env);
        if (pathname === '/console/questions/import' && method === 'POST') return await handleQuestionImport(request, env);
        if (pathname === '/console/stats' && method === 'GET') return await handleStats(env);
        if (pathname === '/console/resource-progress' && method === 'GET') return await handleConsoleResourceProgressList(env);
        if (pathname === '/console/exam-attempts' && method === 'GET') return await handleConsoleExamAttemptsList(env);
        return json({ error: 'not_found' }, 404);
      }

      // Everything else requires a valid bearer token.
      const user = await requireUser(request, env);
      if (!user) return json({ error: 'unauthorized' }, 401);

      if (pathname === '/questions/next' && method === 'GET') return await handleNextQuestion(user, env, url.searchParams.get('difficulty'));
      if (pathname === '/answer' && method === 'POST') return await handleAnswer(user, request, env);
      if (pathname === '/progress' && method === 'GET') return await handleProgress(user, env);
      if (pathname === '/resources/progress' && method === 'GET') return await handleResourceProgressGet(user, env);
      if (pathname === '/resources/progress' && method === 'POST') return await handleResourceProgressUpdate(user, request, env);
      if (pathname === '/exam/config' && method === 'GET') return await handleExamConfig(request, env);
      if (pathname === '/exam/current' && method === 'GET') return await handleExamCurrent(user, env);
      if (pathname === '/exam/start' && method === 'POST') return await handleExamStart(user, env);
      if (pathname === '/exam/answer' && method === 'POST') return await handleExamAnswer(user, request, env);
      if (pathname === '/exam/submit' && method === 'POST') return await handleExamSubmit(user, request, env);
      if (pathname === '/exam/history' && method === 'GET') return await handleExamHistory(user, env);
      if (pathname === '/exam/attempt' && method === 'GET') return await handleExamAttemptDetail(user, request, env);
      if (pathname === '/prefs' && method === 'GET') return await handlePrefsGet(user);
      if (pathname === '/prefs' && method === 'POST') return await handlePrefsSet(user, request, env);
      if (pathname === '/resources/sign-batch' && method === 'POST') return await handleResourcesSignBatch(request, env);

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'internal_error', message: err.message }, 500);
    }
  },
};
