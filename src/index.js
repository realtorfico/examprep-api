import { verifyTurnstile, requireUser, requireAccess, getAccessEmail, newId, newCode } from './lib/auth.js';
import { createPayPalOrder, capturePayPalOrder } from './lib/paypal.js';
import { createStripePaymentIntent, retrieveStripePaymentIntent } from './lib/stripe.js';
import { sendCodeEmail, sendReferralInviteEmail, sendPointsEarnedEmail, sendRedeemVerifyEmail, sendAdminAlertEmail, sendReengagementEmail, sendPromoVerifyEmail } from './lib/email.js';
import { signMediaUrl, verifyMediaSig } from './lib/mediaSign.js';
import { PROGRESS_TOTALS_SQL, PROGRESS_BY_TOPIC_SQL, CONSOLE_QUIZ_PROGRESS_SQL, STATS_ACCURACY_BY_TOPIC_SQL, LEADERBOARD_SQL } from './progressQueries.js';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}
const now = () => Math.floor(Date.now() / 1000);

// examprep-api has no public route -- every request arrives via a Pages Service Binding proxy
// (see each site's _worker.js) that forwards the original request unchanged aside from path, so
// request.url's host is whichever public domain the browser actually hit. Used to build links
// that should point back to that same domain rather than a hardcoded one.
const requestOrigin = (request) => new URL(request.url).origin;

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

// ---- WebMCP / remote MCP server ------------------------------------------
// Public, unauthenticated MCP tools so AI assistants (ChatGPT, Perplexity, Claude, a browser
// WebMCP agent via Cloudflare's bridge script, etc.) can demo real practice questions in-chat and
// link back to the site -- the AEO/try-before-you-buy funnel described in temp/WebMcp.txt. Reuses
// handleSample's exact selection query (ORDER BY weight DESC, RANDOM()) rather than a new
// "is_public_sample" flag, so the exposed question pool is the same self-limiting top-weight tier
// /sample already exposes unauthenticated -- no new schema, no new trust boundary. Grading trusts
// question IDs the same way the authenticated quiz flow does: they're non-enumerable UUIDs
// (newId()), so no additional scoping is needed on the lookup.
const MCP_PROTOCOL_VERSION = '2025-06-18';
const MCP_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id',
};
const MCP_TOOLS = [
  {
    name: 'get_sample_question',
    title: 'Get a sample exam question',
    description: 'Fetch a real practice question from Softician Exam Prep\'s California Notary Public exam question bank. Returns the question and its 4 answer choices (A-D) WITHOUT the correct answer -- call grade_practice_answer with the returned questionId once you have a response to check it and see the explanation.',
    annotations: {
      title: 'Get a sample exam question',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Optional topic to filter by, e.g. "Fees", "Journal", "Bonds". Omit for any topic.' },
        examType: { type: 'string', description: 'Which exam track. Currently only "notary" (California Notary Public exam) is available.', default: 'notary' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        questionId: { type: 'string' },
        examType: { type: 'string' },
        topic: { type: 'string' },
        question: { type: 'string' },
        choices: {
          type: 'object',
          properties: { A: { type: 'string' }, B: { type: 'string' }, C: { type: 'string' }, D: { type: 'string' } },
          required: ['A', 'B', 'C', 'D'],
        },
      },
      required: ['questionId', 'examType', 'topic', 'question', 'choices'],
    },
  },
  {
    name: 'grade_practice_answer',
    title: 'Grade a practice answer',
    description: 'Grade a response to a practice question previously returned by get_sample_question, and return whether it was correct plus the official explanation.',
    annotations: {
      title: 'Grade a practice answer',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'The questionId returned by get_sample_question.' },
        response: { type: 'string', enum: ['A', 'B', 'C', 'D'], description: 'The letter choice being graded.' },
      },
      required: ['questionId', 'response'],
    },
    outputSchema: {
      type: 'object',
      properties: { correct: { type: 'boolean' }, correctChoice: { type: 'string' }, explanation: { type: 'string' } },
      required: ['correct', 'correctChoice', 'explanation'],
    },
  },
];

async function mcpGetSampleQuestion(env, args) {
  const examType = (args && args.examType) || 'notary';
  const topic = args && args.topic;
  let row = topic
    ? await env.DB.prepare('SELECT * FROM questions WHERE exam_type = ? AND topic = ? ORDER BY weight DESC, RANDOM() LIMIT 1').bind(examType, topic).first()
    : null;
  if (!row) row = await env.DB.prepare('SELECT * FROM questions WHERE exam_type = ? ORDER BY weight DESC, RANDOM() LIMIT 1').bind(examType).first();
  if (!row) return { error: `No practice questions available for examType "${examType}".` };
  return {
    questionId: row.id, examType: row.exam_type, topic: row.topic, question: row.question,
    choices: { A: row.choice_a, B: row.choice_b, C: row.choice_c, D: row.choice_d },
  };
}

async function mcpGradePracticeAnswer(env, args) {
  const questionId = args && args.questionId;
  const response = args && args.response;
  if (!questionId || !['A', 'B', 'C', 'D'].includes(response)) {
    return { error: 'questionId and a response of A, B, C, or D are required.' };
  }
  const row = await env.DB.prepare('SELECT * FROM questions WHERE id = ?').bind(questionId).first();
  if (!row) return { error: `Unknown questionId "${questionId}" -- call get_sample_question first to get a valid one.` };
  return { correct: response === row.correct_choice, correctChoice: row.correct_choice, explanation: row.explanation };
}

function mcpToolResultText(toolName, data) {
  if (data.error) return data.error;
  if (toolName === 'get_sample_question') {
    return `[${data.topic}] ${data.question}\nA) ${data.choices.A}\nB) ${data.choices.B}\nC) ${data.choices.C}\nD) ${data.choices.D}\n\n` +
      `(questionId: ${data.questionId} -- pass this to grade_practice_answer with the chosen letter)\n` +
      `Full mock exams and progress tracking: https://examprep.softician.com`;
  }
  const verdict = data.correct ? 'Correct!' : `Not quite -- the correct answer is ${data.correctChoice}.`;
  return `${verdict} ${data.explanation}\n\nFull mock exams and progress tracking: https://examprep.softician.com`;
}

function mcpJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...MCP_CORS_HEADERS },
  });
}
function mcpErrorResponse(id, code, message) {
  return mcpJson({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });
}

async function handleMcp(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { ...MCP_CORS_HEADERS, Allow: 'POST, OPTIONS' } });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return mcpErrorResponse(null, -32700, 'Parse error');
  }
  if (Array.isArray(body)) return mcpErrorResponse(null, -32600, 'Batch requests are not supported.');
  const { jsonrpc, id, method, params } = body || {};
  if (jsonrpc !== '2.0' || typeof method !== 'string') return mcpErrorResponse(id, -32600, 'Invalid Request');
  const isNotification = id === undefined;

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return new Response(null, { status: 202, headers: MCP_CORS_HEADERS });
  }

  if (method === 'initialize') {
    return mcpJson({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'examprep-mcp', title: 'Softician Exam Prep', version: '1.0.0' },
        instructions: 'Public, unauthenticated tools for California Notary Public exam prep: fetch a real practice question and grade a submitted answer. Full mock exams and progress tracking are at https://examprep.softician.com.',
      },
    });
  }

  if (method === 'tools/list') return mcpJson({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } });

  if (method === 'tools/call') {
    const toolName = params && params.name;
    const args = (params && params.arguments) || {};
    let data;
    if (toolName === 'get_sample_question') data = await mcpGetSampleQuestion(env, args);
    else if (toolName === 'grade_practice_answer') data = await mcpGradePracticeAnswer(env, args);
    else return mcpErrorResponse(id, -32602, `Unknown tool "${toolName}"`);

    const isError = !!data.error;
    const result = { content: [{ type: 'text', text: mcpToolResultText(toolName, data) }], isError };
    if (!isError) result.structuredContent = data;
    return mcpJson({ jsonrpc: '2.0', id, result });
  }

  if (isNotification) return new Response(null, { status: 202, headers: MCP_CORS_HEADERS });
  return mcpErrorResponse(id, -32601, `Method not found: ${method}`);
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
async function notifyAdmin(env, title, bodyHtml, replyTo) {
  try {
    const to = await getAppSetting(env, 'admin_alert_email', '');
    if (!to) return;
    await sendAdminAlertEmail(env, to, title, bodyHtml, replyTo);
  } catch (e) { /* best-effort */ }
}

// ---- Daily health check (Cloudflare Cron Trigger, see wrangler.jsonc) -----
// Guards against the 2026-08-08 incident: STRIPE_SECRET_KEY silently disappeared from this
// Worker's Cloudflare secrets with no loud error until a real buyer hit checkout. Stripe is
// checked live (a cheap read-only call proves the key is both present AND still valid, not
// just non-empty -- catches a revoked/rolled key too); the rest are presence-only since a
// wiped secret -- not a wrong value -- is the specific failure mode this is guarding against.
const OTHER_REQUIRED_SECRETS = ['TURNSTILE_SECRET', 'RESEND_API_KEY', 'MEDIA_SIGNING_SECRET'];

async function checkStripeSecretLive(env) {
  if (!env.STRIPE_SECRET_KEY) return 'STRIPE_SECRET_KEY is not set';
  const res = await fetch('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return `Stripe rejected STRIPE_SECRET_KEY: ${(data.error && data.error.message) || res.status}`;
}

async function runDailyHealthCheck(env) {
  const problems = [];
  const stripeProblem = await checkStripeSecretLive(env);
  if (stripeProblem) problems.push(stripeProblem);
  for (const name of OTHER_REQUIRED_SECRETS) {
    if (!env[name]) problems.push(`${name} is not set`);
  }
  if (!problems.length) return;

  console.error('Daily health check failed:', problems.join('; '));
  // Deliberately does NOT use notifyAdmin's silent-no-op-if-unconfigured wrapper -- an
  // unconfigured admin_alert_email (or a dead RESEND_API_KEY, ironically) should be loud here
  // via the console.error above, which shows up in the Worker's Logs tab even if the email
  // itself can't be sent, so this failure never goes completely unnoticed.
  const to = await getAppSetting(env, 'admin_alert_email', '');
  if (!to) return;
  await sendAdminAlertEmail(env, to, '⚠️ ExamPrep daily health check failed',
    '<p>The daily automated check found a problem:</p><ul>' +
    problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('') +
    '</ul><p>Most likely a Worker secret was cleared in the Cloudflare dashboard -- check ' +
    'examprep-api’s Settings &gt; Variables and Secrets.</p>');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Public "Contact Admin" form -- forwards to whatever admin_alert_email is set (examprep-admin's
// Settings tab), with reply-to set to the visitor so the admin can just hit reply. No new table --
// this is a straight-through notification, not something that needs to be listed/reviewed later.
// Deliberately does NOT go through notifyAdmin()'s silent-no-op-if-unconfigured wrapper -- that's
// fine for best-effort background alerts, but here the visitor is told "message sent", so a missing
// destination or a failed send must surface as a real error instead of quietly losing the message.
async function handleContactSubmit(request, env) {
  const { name, email, message, turnstileToken } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  const trimmedEmail = (email || '').trim();
  const trimmedMessage = (message || '').trim();
  if (!trimmedEmail || !trimmedMessage) return json({ error: 'email_and_message_required' }, 400);
  if (trimmedMessage.length > 5000) return json({ error: 'message_too_long' }, 400);

  const to = await getAppSetting(env, 'admin_alert_email', '');
  if (!to) return json({ error: 'contact_not_configured' }, 503);

  const bodyHtml = `<p><strong>From:</strong> ${escapeHtml(name ? name.trim() : 'Anonymous')} (${escapeHtml(trimmedEmail)})</p>` +
    `<p>${escapeHtml(trimmedMessage).replace(/\n/g, '<br>')}</p>`;
  try {
    await sendAdminAlertEmail(env, to, 'New contact form message', bodyHtml, trimmedEmail);
  } catch (e) {
    return json({ error: 'send_failed' }, 502);
  }
  return json({ ok: true });
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

// Color thresholds for the Progress tab's headline Accuracy/Coverage stat boxes (admin-editable in
// examprep-admin's Settings tab) -- green/bold at or above, red/bold below. Also consumed by the
// student site's and admin console's own per-topic tables (both Accuracy and Coverage columns).
// Deliberately separate from EXAM_CONFIGS[examType].passPercent, which grades actual mock exam
// attempts against the real exam's own pass score -- that one is a fact about the real exam and is
// NOT admin-configurable; these thresholds are purely a personal-progress display preference.
const DEFAULT_PROGRESS_ACCURACY_PASS_PCT = 80;
const DEFAULT_PROGRESS_COVERAGE_PASS_PCT = 50;

async function getProgressPassPcts(env) {
  const [accuracyRaw, coverageRaw] = await Promise.all([
    getAppSetting(env, 'progress_accuracy_pass_pct', String(DEFAULT_PROGRESS_ACCURACY_PASS_PCT)),
    getAppSetting(env, 'progress_coverage_pass_pct', String(DEFAULT_PROGRESS_COVERAGE_PASS_PCT)),
  ]);
  const accuracyPassPct = parseInt(accuracyRaw, 10);
  const coveragePassPct = parseInt(coverageRaw, 10);
  return {
    accuracyPassPct: Number.isFinite(accuracyPassPct) ? accuracyPassPct : DEFAULT_PROGRESS_ACCURACY_PASS_PCT,
    coveragePassPct: Number.isFinite(coveragePassPct) ? coveragePassPct : DEFAULT_PROGRESS_COVERAGE_PASS_PCT,
  };
}

async function handlePricingGet(request, env) {
  const url = new URL(request.url);
  const examType = url.searchParams.get('examType') || 'notary';
  const { priceCents, currency } = await getPrice(env, examType);
  const minPaypalChargeCents = await getMinPaypalChargeCents(env);
  return json({ examType, priceCents, currency, minPaypalChargeCents });
}

// Small, unauthenticated, site-wide config -- fetched once at boot (not tied to any one page) so
// the footer and other chrome that renders before/without any other API call can still reflect
// admin-configurable values instead of a stale hardcoded default.
async function handlePublicConfig(env) {
  const [refundFailurePercent, progressPassPcts] = await Promise.all([
    getRefundFailurePercent(env),
    getProgressPassPcts(env),
  ]);
  return json({
    refundFailurePercent,
    accuracyPassPct: progressPassPcts.accuracyPassPct,
    coveragePassPct: progressPassPcts.coveragePassPct,
  });
}

// ---- Promotions ----------------------------------------------------------
// Admin-configurable banners (examprep-admin's Promotions tab) shown on the public site's home
// and/or checkout pages. A promo with promo_code set is a real discount, redeemed by typing that
// code at checkout -- see quoteCheckout below for how it's applied and re-verified server-side.

function normalizePromoCode(code) { return (code || '').trim().toUpperCase(); }

async function findActivePromoByCode(env, code) {
  const normalized = normalizePromoCode(code);
  if (!normalized) return null;
  return await env.DB.prepare(
    `SELECT * FROM promotions WHERE active = 1 AND promo_code IS NOT NULL AND UPPER(promo_code) = ?`
  ).bind(normalized).first();
}

// Codeless discounts (no promo_code) auto-apply whenever the buyer's email matches -- there's
// nothing secret to type, so there's no lookup key besides the email itself. Only a handful of
// promotions exist at a time, so fetching all codeless ones and checking suffixes in JS is simpler
// than a SQL LIKE per row and avoids the '_'/'%' wildcard-escaping footgun that'd come with LIKE.
async function findActiveDomainPromoForEmail(env, email) {
  if (!email) return null;
  // discount_value IS NOT NULL scopes this to actual checkout discounts -- a points-multiplier-only
  // promotion (see handlePromoRedeemPointsMultiplier) never auto-applies at checkout even if it
  // also happens to have a required_email_domain set with no code.
  const rows = (await env.DB.prepare(
    `SELECT * FROM promotions WHERE active = 1 AND promo_code IS NULL AND required_email_domain IS NOT NULL
     AND discount_value IS NOT NULL ORDER BY sort_order ASC`
  ).all()).results;
  return rows.find((p) => email.endsWith(p.required_email_domain)) || null;
}

function promoDiscountCentsFor(promo, priceCents) {
  if (!promo) return 0;
  if (promo.discount_type === 'percent') return Math.round(priceCents * promo.discount_value / 100);
  if (promo.discount_type === 'flat_cents') return Math.min(priceCents, promo.discount_value);
  return 0;
}

// Public listing -- only active promos, only the fields a visitor needs to see (no internal
// id/sort_order/redeemed_count). promo_code/discount fields ARE included when present -- the
// whole point of advertising a code is telling the visitor what to type.
async function handlePromotionsList(request, env) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('placement');
  const placement = ['home', 'checkout', 'refer'].indexOf(requested) !== -1 ? requested : 'home';
  // 'both' only ever means home+checkout (see schema.sql) -- 'refer' is its own explicit choice,
  // not folded into 'both', since it's a distinct page/audience from the storefront banners.
  const placementFilter = placement === 'refer' ? 'placement = ?' : "(placement = ? OR placement = 'both')";
  const rows = (await env.DB.prepare(
    `SELECT id, title, body, cta_label AS ctaLabel, cta_url AS ctaUrl, promo_code AS promoCode,
            discount_type AS discountType, discount_value AS discountValue,
            required_email_domain AS requiredEmailDomain, require_email_verification AS requireEmailVerification,
            points_multiplier AS pointsMultiplier, points_multiplier_days AS pointsMultiplierDays
     FROM promotions WHERE active = 1 AND ${placementFilter} ORDER BY sort_order ASC`
  ).bind(placement).all()).results;
  return json({ promotions: rows });
}

const PROMO_EMAIL_VERIFY_TTL_SECONDS = 604800; // 7 days to click the confirmation email, and how
                                                // long the verified status stays usable at checkout

async function isPromoEmailVerified(env, promoId, email) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM pending_promo_email_verifications
     WHERE promo_id = ? AND email = ? AND verified_at IS NOT NULL AND expires_at > ? LIMIT 1`
  ).bind(promoId, email, now()).first();
  return !!row;
}

// Sends (or re-sends) a one-time confirmation link for a promo that requires verified email
// ownership -- called explicitly by the checkout UI once quoteCheckout has already told it
// verification is needed, never automatically on every price-quote request. Doesn't dedupe/reuse
// an existing pending row -- a fresh row+link per request is simplest, and a few valid links for
// the same promo+email is harmless (any one of them verifies it).
async function handlePromoVerifyRequest(request, env) {
  const { promoCode, promoId, email, turnstileToken } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if ((!promoCode && !promoId) || !email) return json({ error: 'promo_and_email_required' }, 400);

  // promoId (no code to type) covers the auto-detected domain-gated case; promoCode covers the
  // classic coded case -- either identifies the same promotion, just via a different path.
  const promo = promoCode
    ? await findActivePromoByCode(env, promoCode)
    : await env.DB.prepare('SELECT * FROM promotions WHERE id = ? AND active = 1').bind(promoId).first();
  if (!promo) return json({ error: 'invalid_promo_code' }, 400);
  if (!promo.require_email_verification) return json({ error: 'verification_not_required' }, 400);

  const normalizedEmail = email.trim().toLowerCase();
  if (promo.required_email_domain && !normalizedEmail.endsWith(promo.required_email_domain)) {
    return json({ error: 'promo_email_domain_required', requiredEmailDomain: promo.required_email_domain }, 400);
  }
  if (await isPromoEmailVerified(env, promo.id, normalizedEmail)) return json({ alreadyVerified: true });

  const verifyToken = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO pending_promo_email_verifications (id, promo_id, email, verify_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(newId(), promo.id, normalizedEmail, verifyToken, now(), now() + PROMO_EMAIL_VERIFY_TTL_SECONDS).run();

  const verifyUrl = `${requestOrigin(request)}/notary#/promo-verify/${verifyToken}`;
  await sendPromoVerifyEmail(env, normalizedEmail, promo.title, verifyUrl);

  return json({ sent: true });
}

async function handlePromoVerifyEmailConfirm(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'token_required' }, 400);

  const pending = await env.DB.prepare(
    'SELECT * FROM pending_promo_email_verifications WHERE verify_token = ? AND expires_at > ?'
  ).bind(token, now()).first();
  if (!pending) return json({ error: 'invalid_or_expired_token' }, 404);

  if (!pending.verified_at) {
    await env.DB.prepare('UPDATE pending_promo_email_verifications SET verified_at = ? WHERE id = ?')
      .bind(now(), pending.id).run();
  }

  const promo = await env.DB.prepare('SELECT title FROM promotions WHERE id = ?').bind(pending.promo_id).first();
  return json({ ok: true, promoTitle: promo ? promo.title : null });
}

// Redeems a points-multiplier promotion (e.g. "retired professionals get 2x points") on the
// Refer-a-Friend page -- a completely different "effect" than a checkout discount, sharing only
// the code/domain/verification lookup machinery. Sets the multiplier directly on the account
// (get-or-create by email, same as a referral) so every future awardPoints call picks it up until
// it expires; nothing retroactive, and nothing to undo if it's not renewed.
async function handlePromoRedeemPointsMultiplier(request, env) {
  const { promoCode, email, turnstileToken } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!promoCode || !email) return json({ error: 'promoCode_and_email_required' }, 400);

  const promo = await findActivePromoByCode(env, promoCode);
  if (!promo || !promo.points_multiplier) return json({ error: 'invalid_promo_code' }, 400);

  const normalizedEmail = email.trim().toLowerCase();
  if (promo.required_email_domain && !normalizedEmail.endsWith(promo.required_email_domain)) {
    return json({ error: 'promo_email_domain_required', requiredEmailDomain: promo.required_email_domain }, 400);
  }
  if (promo.require_email_verification && !(await isPromoEmailVerified(env, promo.id, normalizedEmail))) {
    return json({ error: 'promo_email_verification_required', promoId: promo.id, promoTitle: promo.title }, 400);
  }

  const account = await getOrCreateAccount(env, normalizedEmail, null);
  const expiresAt = now() + (promo.points_multiplier_days || 0) * 86400;
  await env.DB.prepare('UPDATE accounts SET points_multiplier = ?, points_multiplier_expires_at = ? WHERE id = ?')
    .bind(promo.points_multiplier, expiresAt, account.id).run();
  await env.DB.prepare('UPDATE promotions SET redeemed_count = redeemed_count + 1 WHERE id = ?').bind(promo.id).run();

  return json({ ok: true, multiplier: promo.points_multiplier, expiresAt });
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

// Shared by both processors' create-order/create-intent handlers -- points and a promo code are
// only ever quoted here, never applied, that only happens once a payment actually completes (see
// finalizePurchase), so an abandoned checkout costs nothing. Returns { fullyCoveredByPoints: true }
// instead of a quote when the discount covers the whole price, since that case should route
// through /points/redeem instead of a real charge -- callers check for it explicitly. Returns
// { error: 'invalid_promo_code' } if a promoCode was given but doesn't match an active promotion,
// { error: 'promo_email_domain_required', requiredEmailDomain } if a CODED promo needs a matching
// email (e.g. a '.edu' student discount) and the given email doesn't qualify (or none was given),
// { error: 'promo_email_verification_required', promoId, promoTitle } if the promo (coded or
// auto-detected) also requires that email to have clicked a confirmation link (see
// handlePromoVerifyRequest) and it hasn't yet, { error: 'promo_first_purchase_only_email_required' }
// if the promo is restricted to first-time buyers and no email was given, or
// { error: 'promo_not_first_purchase' } if that email already appears as a buyer_email on an
// existing `codes` row (i.e. this account already has access, however it was obtained). Promo
// discount is applied BEFORE points, so points then discount whatever the promo left.
//
// A promoCode always resolves by exact match; with none given but an email present, a codeless
// domain-gated promo (see findActiveDomainPromoForEmail) auto-applies if the email's domain
// matches -- no code to type, since the domain+verification checks are the real gate for that
// promo type, not the code. No email + no code just means no promo, not an error.
//
// Exactly one promotion can ever apply to a single checkout -- promoCode resolves by exact match
// OR (only when absent) a domain match is tried, never both, so there's no path to stacking two
// promo discounts on the same purchase. Referral points remain a separate, deliberately-stackable
// mechanism (see the fullyCoveredByPoints note below), not a second promotion.
//
// NOTE: the fullyCoveredByPoints shortcut is deliberately only offered when there's no promo --
// /points/redeem checks points against the full undiscounted price, with no promo awareness, so
// routing a promo'd order there would wrongly require enough points to cover the FULL price. With
// a promo active, points can still apply as a partial discount on top of it, just never all the
// way to $0 through that other endpoint.
async function quoteCheckout(env, examType, email, applyPoints, promoCode) {
  const { priceCents, currency } = await getPrice(env, examType);
  const normalizedEmail = (email || '').trim().toLowerCase();
  let promo = null;
  let promoDiscountCents = 0;
  if (promoCode) {
    promo = await findActivePromoByCode(env, promoCode);
    if (!promo) return { error: 'invalid_promo_code' };
    if (promo.required_email_domain && !normalizedEmail.endsWith(promo.required_email_domain)) {
      return { error: 'promo_email_domain_required', requiredEmailDomain: promo.required_email_domain };
    }
  } else if (normalizedEmail) {
    promo = await findActiveDomainPromoForEmail(env, normalizedEmail); // null just means no match -- not an error
  }
  if (promo) {
    if (promo.first_purchase_only) {
      if (!normalizedEmail) return { error: 'promo_first_purchase_only_email_required' };
      const priorCode = await env.DB.prepare('SELECT 1 FROM codes WHERE LOWER(buyer_email) = ? LIMIT 1')
        .bind(normalizedEmail).first();
      if (priorCode) return { error: 'promo_not_first_purchase' };
    }
    if (promo.require_email_verification && !(await isPromoEmailVerified(env, promo.id, normalizedEmail))) {
      return { error: 'promo_email_verification_required', promoId: promo.id, promoTitle: promo.title };
    }
    promoDiscountCents = promoDiscountCentsFor(promo, priceCents);
  }
  const workingPriceCents = Math.max(0, priceCents - promoDiscountCents);
  let finalPriceCents = workingPriceCents;
  let pointsToApply = 0;
  if (applyPoints && email) {
    const account = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email.trim().toLowerCase()).first();
    if (account && account.points > 0) {
      pointsToApply = Math.min(account.points, workingPriceCents);
      if (pointsToApply >= workingPriceCents && !promo) return { fullyCoveredByPoints: true };
      // A partial discount can't leave less than the admin-set floor payable through the
      // processor -- cap the points actually applied so the leftover doesn't dip below it
      // (unapplied points just stay in the account for next time, nothing is lost).
      const minChargeCents = await getMinPaypalChargeCents(env);
      if (workingPriceCents - pointsToApply < minChargeCents) {
        pointsToApply = Math.max(0, workingPriceCents - minChargeCents);
      }
      finalPriceCents = workingPriceCents - pointsToApply;
    }
  }
  return { priceCents, currency, finalPriceCents, pointsToApply, promo, promoDiscountCents };
}

// Shared by both processors' capture/confirm handlers, called only after the processor-specific
// code has verified the payment actually completed and the captured amount matches what was
// quoted. Handles point deduction, code issuance, receipt email, referral crediting, and the
// admin activity alert -- the one thing that's genuinely identical regardless of processor.
async function finalizePurchase(env, { examType, note, capturedCents, payerEmail, email, discount, promoDiscount }) {
  const { code, token } = await issueAndRedeemCode(env, examType, note, capturedCents, payerEmail || email);

  if (discount) {
    // MAX(0, ...) floors it defensively in case the balance somehow changed since create-order
    // (e.g. another purchase in a different tab) — the buyer already got the discount they paid
    // for either way, so we don't fail the purchase over a stale points snapshot.
    await env.DB.prepare('UPDATE accounts SET points = MAX(0, points - ?) WHERE email = ?')
      .bind(discount.points_to_apply, discount.email).run();
    await env.DB.prepare('DELETE FROM pending_point_discounts WHERE order_id = ?').bind(discount.order_id).run();
  }

  if (promoDiscount) {
    await env.DB.prepare('UPDATE promotions SET redeemed_count = redeemed_count + 1 WHERE id = ?').bind(promoDiscount.promo_id).run();
    await env.DB.prepare('DELETE FROM pending_promo_discounts WHERE order_id = ?').bind(promoDiscount.order_id).run();
  }

  if (email) {
    try { await sendCodeEmail(env, email, code, examType); } catch (e) { /* best-effort, buyer already has the code on-screen */ }
  }

  await detectAndCreditConversion(env, payerEmail);
  await notifyAdmin(env, 'New purchase',
    `<p><strong>${payerEmail || email || 'A buyer'}</strong> just bought ${examType} access for ` +
    `$${(capturedCents / 100).toFixed(2)}` +
    (discount ? ` (${discount.points_to_apply} points applied as a discount)` : '') +
    (promoDiscount ? ` (promo code ${promoDiscount.code} applied, -$${(promoDiscount.discount_cents / 100).toFixed(2)})` : '') +
    `.</p>`);

  return { code, token, pointsApplied: discount ? discount.points_to_apply : 0 };
}

async function handlePaypalCreateOrder(request, env) {
  const { examType, turnstileToken, email, applyPoints, promoCode } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!examType) return json({ error: 'examType_required' }, 400);

  const quote = await quoteCheckout(env, examType, email, applyPoints, promoCode);
  if (quote.error) {
    return json({ error: quote.error, requiredEmailDomain: quote.requiredEmailDomain, promoId: quote.promoId, promoTitle: quote.promoTitle }, 400);
  }
  if (quote.fullyCoveredByPoints) return json({ error: 'fully_covered_by_points' }, 400); // client should use /points/redeem instead

  const order = await createPayPalOrder(env, quote.finalPriceCents, quote.currency);

  if (quote.pointsToApply > 0) {
    await env.DB.prepare(
      'INSERT INTO pending_point_discounts (order_id, email, points_to_apply, created_at) VALUES (?, ?, ?, ?)'
    ).bind(order.id, email.trim().toLowerCase(), quote.pointsToApply, now()).run();
  }
  if (quote.promo) {
    await env.DB.prepare(
      'INSERT INTO pending_promo_discounts (order_id, promo_id, code, discount_cents, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(order.id, quote.promo.id, quote.promo.promo_code, quote.promoDiscountCents, now()).run();
  }

  return json({ orderId: order.id, priceCents: quote.finalPriceCents, pointsApplied: quote.pointsToApply, promoDiscountCents: quote.promoDiscountCents || 0, promoTitle: quote.promo ? quote.promo.title : undefined });
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
  const promoDiscount = await env.DB.prepare('SELECT * FROM pending_promo_discounts WHERE order_id = ?').bind(orderId).first();
  const expectedCents = Math.max(0, fullPriceCents
    - (discount ? discount.points_to_apply : 0)
    - (promoDiscount ? promoDiscount.discount_cents : 0));

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
  const { code, token, pointsApplied } = await finalizePurchase(env, { examType, note, capturedCents, payerEmail, email, discount, promoDiscount });

  return json({ code, token, examType, pointsApplied });
}

async function handleStripeCreateIntent(request, env) {
  const { examType, turnstileToken, email, applyPoints, promoCode } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: 'turnstile_failed' }, 400);
  }
  if (!examType) return json({ error: 'examType_required' }, 400);

  const quote = await quoteCheckout(env, examType, email, applyPoints, promoCode);
  if (quote.error) {
    return json({ error: quote.error, requiredEmailDomain: quote.requiredEmailDomain, promoId: quote.promoId, promoTitle: quote.promoTitle }, 400);
  }
  if (quote.fullyCoveredByPoints) return json({ error: 'fully_covered_by_points' }, 400); // client should use /points/redeem instead

  const intent = await createStripePaymentIntent(env, quote.finalPriceCents, quote.currency, { email, examType });

  if (quote.pointsToApply > 0) {
    await env.DB.prepare(
      'INSERT INTO pending_point_discounts (order_id, email, points_to_apply, created_at) VALUES (?, ?, ?, ?)'
    ).bind(intent.id, email.trim().toLowerCase(), quote.pointsToApply, now()).run();
  }
  if (quote.promo) {
    await env.DB.prepare(
      'INSERT INTO pending_promo_discounts (order_id, promo_id, code, discount_cents, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(intent.id, quote.promo.id, quote.promo.promo_code, quote.promoDiscountCents, now()).run();
  }

  return json({ clientSecret: intent.client_secret, priceCents: quote.finalPriceCents, pointsApplied: quote.pointsToApply, promoDiscountCents: quote.promoDiscountCents || 0, promoTitle: quote.promo ? quote.promo.title : undefined });
}

async function handleStripeConfirm(request, env) {
  const { paymentIntentId, examType, email } = await request.json();
  if (!paymentIntentId || !examType) return json({ error: 'paymentIntentId_and_examType_required' }, 400);

  // Idempotency: a retried confirm call for an intent we've already issued a code for just
  // re-mints a token for the existing account, instead of risking a double-issue.
  const note = `stripe:${paymentIntentId}`;
  const existing = await env.DB.prepare('SELECT * FROM codes WHERE note = ?').bind(note).first();
  if (existing) {
    const token = crypto.randomUUID();
    await env.DB.prepare('UPDATE users SET token = ?, last_seen_at = ? WHERE id = ?')
      .bind(token, now(), existing.redeemed_by).run();
    return json({ code: existing.code, token, examType: existing.exam_type });
  }

  const { priceCents: fullPriceCents } = await getPrice(env, examType);
  const discount = await env.DB.prepare('SELECT * FROM pending_point_discounts WHERE order_id = ?').bind(paymentIntentId).first();
  const promoDiscount = await env.DB.prepare('SELECT * FROM pending_promo_discounts WHERE order_id = ?').bind(paymentIntentId).first();
  const expectedCents = Math.max(0, fullPriceCents
    - (discount ? discount.points_to_apply : 0)
    - (promoDiscount ? promoDiscount.discount_cents : 0));

  const intent = await retrieveStripePaymentIntent(env, paymentIntentId);
  if (intent.status !== 'succeeded') return json({ error: 'payment_not_completed' }, 402);
  if (intent.amount_received !== expectedCents) return json({ error: 'amount_mismatch' }, 402);

  // Stripe echoes back the receipt email we set at creation, plus the actual billing email
  // from whichever payment method the buyer used (card, Apple Pay, Google Pay), which can
  // differ -- prefer the latter, same "trust what the processor tells us" approach as PayPal.
  const charge = intent.latest_charge;
  const payerEmail = (charge && charge.billing_details && charge.billing_details.email) || intent.receipt_email;
  const { code, token, pointsApplied } = await finalizePurchase(env, { examType, note, capturedCents: intent.amount_received, payerEmail, email, discount, promoDiscount });

  return json({ code, token, examType, pointsApplied });
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
// underlying action (verification/conversion still records normally either way). Applies the
// account's points_multiplier (from redeeming a points-multiplier promotion -- see
// handlePromoRedeemPointsMultiplier) if one is set and not yet expired; an expired multiplier is
// just treated as 1x rather than actively cleared, so there's nothing to keep tidy elsewhere.
async function awardPoints(env, accountId, taskKey) {
  const rule = await env.DB.prepare('SELECT * FROM point_rules WHERE task_key = ? AND active = 1').bind(taskKey).first();
  if (!rule) return 0;
  const account = await env.DB.prepare('SELECT points_multiplier, points_multiplier_expires_at FROM accounts WHERE id = ?').bind(accountId).first();
  const multiplier = (account && account.points_multiplier && account.points_multiplier_expires_at > now()) ? account.points_multiplier : 1;
  const pointsToAward = rule.points * multiplier;
  await env.DB.prepare('UPDATE accounts SET points = points + ? WHERE id = ?').bind(pointsToAward, accountId).run();
  return pointsToAward;
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
      const verifyUrl = `${requestOrigin(request)}/notary#/refer-verify/${verifyToken}`;
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
// Admin-editable in examprep-admin's Settings tab (key: refund_failure_percent) -- the
// 'exam_failure_50pct' claimType string is just a stable internal identifier and is NOT
// renamed when this changes, same as EXAM_CONFIGS keys don't change when their values do.
const DEFAULT_REFUND_FAILURE_PERCENT = 50;

async function getRefundFailurePercent(env) {
  const raw = await getAppSetting(env, 'refund_failure_percent', String(DEFAULT_REFUND_FAILURE_PERCENT));
  const pct = parseInt(raw, 10);
  return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : DEFAULT_REFUND_FAILURE_PERCENT;
}

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

  const failurePercent = await getRefundFailurePercent(env);
  const refundCents = claimType === 'unconditional_7day'
    ? codeRow.paid_cents
    : Math.round(codeRow.paid_cents * (failurePercent / 100));

  const claimId = newId();
  await env.DB.prepare(
    `INSERT INTO refund_claims (id, code, email, claim_type, status, exam_date, confirmation_note, notes, refund_cents, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
  ).bind(claimId, codeRow.code, email.trim().toLowerCase(), claimType, examDate || null, confirmationNote || null, notes || null, refundCents, now()).run();

  await notifyAdmin(env, 'New refund claim',
    `<p>${claimType === 'unconditional_7day' ? '7-day no-questions' : 'exam-failure ' + failurePercent + '%'} refund claim for code ` +
    `<strong>${codeRow.code}</strong> (${email}) — $${(refundCents / 100).toFixed(2)}. Review it in the admin Refund Claims tab.</p>`);

  return json({ ok: true, refundCents });
}

// Joins in the code's `note` (e.g. "stripe:pi_..." / "paypal:ORDER_ID") so the admin can tell
// which processor actually needs to issue the refund, without a separate lookup on the Codes tab.
async function handleConsoleRefundClaimsList(env) {
  const rows = (await env.DB.prepare(
    `SELECT rc.*, c.note AS code_note FROM refund_claims rc LEFT JOIN codes c ON c.code = rc.code ORDER BY rc.created_at DESC LIMIT 500`
  ).all()).results;
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

  const verifyUrl = `${requestOrigin(request)}/notary#/points-redeem-verify/${verifyToken}`;
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

// Chance any given pick interleaves a missed question in ahead of the unseen pool, instead of
// strictly deferring all review until every unseen question is exhausted. With a large bank (this
// one has 1000+ questions), "unseen-first, missed-only-once-exhausted" means a wrong answer could
// go unrevisited for a very long time -- mirrors how spaced-repetition apps (Anki, Duolingo, etc.)
// mix review into new content rather than batching it at the end.
const MISSED_INTERLEAVE_CHANCE = 0.3;

async function findNextQuestionRow(env, user, difficulty) {
  const cte = difficulty ? DIFFICULTY_CTE : '';
  const diffJoin = difficulty ? 'LEFT JOIN q_stats qs ON qs.question_id = q.id' : '';
  const diffFilter = difficulty ? `AND (${DIFFICULTY_CASE}) = ?` : '';
  const diffArgs = difficulty ? [difficulty] : [];

  const pickMissed = () => env.DB.prepare(
    `${cte}SELECT q.* FROM questions q JOIN progress p ON p.question_id = q.id ${diffJoin}
     WHERE p.user_id = ? AND p.last_result = 'incorrect' ${diffFilter} ORDER BY RANDOM() LIMIT 1`
  ).bind(user.id, ...diffArgs).first();

  if (Math.random() < MISSED_INTERLEAVE_CHANCE) {
    const interleaved = await pickMissed();
    if (interleaved) return interleaved;
  }

  const unseen = await env.DB.prepare(
    `${cte}SELECT q.* FROM questions q LEFT JOIN progress p ON p.question_id = q.id AND p.user_id = ? ${diffJoin}
     WHERE q.exam_type = ? AND p.question_id IS NULL ${diffFilter} ORDER BY q.weight DESC, RANDOM() LIMIT 1`
  ).bind(user.id, user.exam_type, ...diffArgs).first();
  if (unseen) return unseen;

  const missed = await pickMissed();
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

// Shared by quiz answers (handleAnswer, one at a time) and mock exam submission
// (handleExamSubmit, batched) -- both modes feed the same per-question "current status" record,
// so whichever mode a question was most recently answered in is what the Progress tab (topic
// breakdown, wrong-questions list, and totals) reflects. Last write wins, no merge logic needed.
function progressUpsertStmt(env, userId, questionId, choice, correctChoice, at) {
  const correct = choice === correctChoice;
  return env.DB.prepare(
    `INSERT INTO progress (user_id, question_id, times_seen, times_correct, last_result, last_choice, last_answered_at)
     VALUES (?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT (user_id, question_id) DO UPDATE SET
       times_seen = times_seen + 1,
       times_correct = times_correct + excluded.times_correct,
       last_result = excluded.last_result,
       last_choice = excluded.last_choice,
       last_answered_at = excluded.last_answered_at`
  ).bind(userId, questionId, correct ? 1 : 0, correct ? 'correct' : 'incorrect', choice || null, at);
}

// Cumulative attempt counts (times_seen/times_correct), NOT distinct-question current-state --
// a question you've missed before and miss again on a resurfaced attempt (see MISSED_INTERLEAVE_CHANCE
// in findNextQuestionRow) must still count as another wrong attempt, even though its row's
// last_result was already 'incorrect' going in. COUNT(*)/last_result-based totals silently ate
// exactly that case (Wrong looked stuck) since a resurfaced miss doesn't add a new progress row.
// SQL lives in progressQueries.js (shared with byTopic/admin queries + the consistency test).
async function progressTotals(env, userId) {
  return env.DB.prepare(PROGRESS_TOTALS_SQL).bind(userId).first();
}

async function handleAnswer(user, request, env) {
  const { questionId, choice } = await request.json();
  const q = await env.DB.prepare('SELECT * FROM questions WHERE id = ?').bind(questionId).first();
  if (!q) return json({ error: 'question_not_found' }, 404);

  await progressUpsertStmt(env, user.id, questionId, choice, q.correct_choice, now()).run();

  // Fresh totals in the same response -- lets the quiz's live stats bar update instantly without
  // a second round-trip (see /progress/summary for the once-per-quiz-view initial fetch instead).
  const totals = await progressTotals(env, user.id);

  return json({
    correct: choice === q.correct_choice, correctChoice: q.correct_choice, explanation: q.explanation,
    totalAnswered: totals.total || 0, totalCorrect: totals.correct || 0,
  });
}

// Lightweight totals-only fetch for the quiz's live stats bar -- avoids pulling the full
// /progress payload (byTopic + every wrong question's full text) just to show 4 numbers.
async function handleProgressSummary(user, env) {
  const totals = await progressTotals(env, user.id);
  return json({ totalAnswered: totals.total || 0, totalCorrect: totals.correct || 0 });
}

async function handleProgress(user, env) {
  const totals = await progressTotals(env, user.id);
  const { accuracyPassPct, coveragePassPct } = await getProgressPassPcts(env);

  // Cumulative attempts (times_seen/times_correct), matching progressTotals above -- these two
  // must agree, since the Progress tab shows the byTopic breakdown right under the headline totals
  // and their totals need to sum to the same number. Also includes every topic in the user's exam
  // (even untouched ones, contributing 0) so per-topic coverage % has a complete denominator.
  const byTopic = await env.DB.prepare(PROGRESS_BY_TOPIC_SQL).bind(user.id, user.exam_type).all();

  // Only questions currently sitting at "incorrect" as of the user's last attempt -- a question
  // missed once but since answered correctly again isn't shown, same "current state" idea as the
  // /questions/next quiz picker's own missed-question query.
  const wrong = await env.DB.prepare(
    `SELECT q.id, q.topic, q.question, q.choice_a, q.choice_b, q.choice_c, q.choice_d,
            q.correct_choice, q.explanation, p.last_choice, p.last_answered_at
     FROM progress p JOIN questions q ON q.id = p.question_id
     WHERE p.user_id = ? AND p.last_result = 'incorrect' ORDER BY p.last_answered_at DESC`
  ).bind(user.id).all();

  return json({
    totalAnswered: totals.total || 0,
    totalCorrect: totals.correct || 0,
    accuracyPassPct,
    coveragePassPct,
    byTopic: byTopic.results,
    wrongQuestions: wrong.results.map((q) => ({
      id: q.id, topic: q.topic, question: q.question,
      choices: { A: q.choice_a, B: q.choice_b, C: q.choice_c, D: q.choice_d },
      correctChoice: q.correct_choice, yourChoice: q.last_choice || null, explanation: q.explanation,
      lastAnsweredAt: q.last_answered_at,
    })),
  });
}

async function handleProgressReset(user, request, env) {
  const { scope } = await request.json();
  if (scope !== 'quiz' && scope !== 'all') return json({ error: 'invalid_scope' }, 400);

  await env.DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(user.id).run();
  if (scope === 'all') {
    await env.DB.prepare('DELETE FROM exam_attempts WHERE user_id = ?').bind(user.id).run();
  }

  return json({ ok: true, scope });
}

// ---- Leaderboard ---------------------------------------------------------
// Top 3 by accuracy and top 3 by coverage, same exam_type (track) as the requesting user only --
// never crosses tracks, since a DRE user's accuracy isn't comparable to a notary user's. Must have
// answered at least MIN_LEADERBOARD_QUESTIONS questions to qualify, so a single lucky question
// can't top the accuracy list. Codes are masked (not full identity) since this is visible to any
// other student on the same track, not just admin. Returns the union of both top-3 sets (not just
// whichever the caller asked for) so the client can toggle sort order without a second round-trip.
const MIN_LEADERBOARD_QUESTIONS = 20;

function maskLeaderboardCode(code) {
  if (!code) return 'Anonymous';
  const parts = code.split('-');
  const first = parts[0] ? parts[0][0] + '*'.repeat(parts[0].length - 1) : '';
  const second = parts[1] ? '*'.repeat(parts[1].length) : '';
  return second ? first + '-' + second : first;
}

async function handleLeaderboard(user, env) {
  const rows = (await env.DB.prepare(LEADERBOARD_SQL).bind(user.exam_type).all()).results;
  const ranked = rows
    .map((r) => ({
      id: r.user_id,
      code: maskLeaderboardCode(r.code),
      total: r.total,
      accuracy: r.total ? Math.round((100 * r.correct) / r.total) : 0,
      coverage: r.topicTotal ? Math.round((100 * r.seen) / r.topicTotal) : 0,
      examAttempts: r.examAttempts,
    }))
    .filter((r) => r.total >= MIN_LEADERBOARD_QUESTIONS);

  const topByAccuracy = ranked.slice().sort((a, b) => b.accuracy - a.accuracy).slice(0, 3);
  const topByCoverage = ranked.slice().sort((a, b) => b.coverage - a.coverage).slice(0, 3);
  const seenIds = new Set();
  const combined = topByAccuracy.concat(topByCoverage)
    .filter((r) => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)))
    .map((r) => ({ code: r.code, total: r.total, accuracy: r.accuracy, coverage: r.coverage, attempts: r.examAttempts }));

  return json({ minQuestions: MIN_LEADERBOARD_QUESTIONS, users: combined });
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
    `SELECT ea.id, ea.user_id, ea.exam_type, ea.mode, ea.score_correct, ea.score_total, ea.started_at, ea.submitted_at,
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
        attemptId: r.id, userId: r.user_id, examType: r.exam_type, mode: r.mode, code: r.code, buyerEmail: r.buyer_email,
        correct: r.score_correct, total: r.score_total, percent, passed: percent >= config.passPercent,
        startedAt: r.started_at, submittedAt: r.submitted_at,
      };
    }),
  });
}

// Full per-question breakdown for one attempt -- fetched on demand when an admin expands a
// specific attempt row, rather than bundled into the list above (that stays a cheap summary scan).
async function handleConsoleExamAttemptDetail(request, env) {
  const url = new URL(request.url);
  const attemptId = url.searchParams.get('attemptId');
  const attempt = attemptId ? await env.DB.prepare('SELECT * FROM exam_attempts WHERE id = ?').bind(attemptId).first() : null;
  if (!attempt) return json({ error: 'attempt_not_found' }, 404);

  const questionIds = JSON.parse(attempt.question_ids);
  const answers = JSON.parse(attempt.answers);
  const byId = await fetchQuestionsByIds(env, questionIds);
  const result = buildExamResult(attempt.exam_type, questionIds, answers, byId,
    attempt.score_correct, attempt.score_total, attempt.started_at, attempt.submitted_at, attempt.duration_sec);
  return json(result);
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

// Per-user, per-topic quiz accuracy -- the same shape (and now the same cumulative-attempts math,
// see progressTotals) as the student's own /progress endpoint's byTopic, just grouped by user_id
// too instead of scoped to one caller. Admin groups these rows client-side into one card per user,
// mirroring resource-progress above.
async function handleConsoleQuizProgressList(env) {
  const rows = (await env.DB.prepare(CONSOLE_QUIZ_PROGRESS_SQL).all()).results;
  const { accuracyPassPct, coveragePassPct } = await getProgressPassPcts(env);
  return json({ items: rows, accuracyPassPct, coveragePassPct, leaderboardMinQuestions: MIN_LEADERBOARD_QUESTIONS });
}

// ---- Re-engagement: stalled buyers --------------------------------------
// "Stalled" = redeemed (active, non-revoked) code, no activity (last_seen_at, updated on every
// authenticated request -- see requireUser) in at least `days`. Admin-triggered, not automatic --
// the admin reviews the list and clicks Send per user, rather than a cron blasting emails unsupervised.

async function handleConsoleStalledBuyersList(request, env) {
  const url = new URL(request.url);
  const days = Math.max(1, parseInt(url.searchParams.get('days'), 10) || 7);
  const cutoff = now() - days * 86400;
  const rows = (await env.DB.prepare(
    `SELECT u.id AS user_id, u.exam_type, u.last_seen_at, u.created_at, u.last_reminder_sent_at, c.code, c.buyer_email
     FROM users u
     JOIN codes c ON c.redeemed_by = u.id
     WHERE u.last_seen_at < ? AND c.status = 'redeemed'
     ORDER BY u.last_seen_at ASC LIMIT 500`
  ).bind(cutoff).all()).results;
  return json({ items: rows, days });
}

async function handleConsoleStalledBuyerRemind(request, env) {
  const { userId } = await request.json();
  if (!userId) return json({ error: 'user_id_required' }, 400);

  const row = await env.DB.prepare(
    `SELECT u.id, u.exam_type, c.buyer_email FROM users u JOIN codes c ON c.redeemed_by = u.id WHERE u.id = ?`
  ).bind(userId).first();
  if (!row) return json({ error: 'user_not_found' }, 404);
  if (!row.buyer_email) return json({ error: 'no_email_on_file' }, 400);

  try {
    await sendReengagementEmail(env, row.buyer_email, row.exam_type);
  } catch (e) {
    return json({ error: 'send_failed' }, 502);
  }
  await env.DB.prepare('UPDATE users SET last_reminder_sent_at = ? WHERE id = ?').bind(now(), userId).run();
  return json({ ok: true });
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
  // 46 questions / 38 correct to pass, per the real CA DMV Class C written knowledge test.
  // 38/46 = 82.6% (buildExamResult rounds percent to 1 decimal via Math.round(x*1000)/10) -- using
  // 82.6 here, not 83, so a candidate who scores exactly the real pass line (38/46) is graded as
  // passing here too, matching the actual DMV threshold instead of a rounded-up approximation of it.
  // The real test is untimed (in-person at a DMV office/kiosk) -- 60 minutes here is a generous
  // stand-in so the timed-mock-exam format still applies, not a real DMV time limit.
  ca_driver: { questionCount: 46, durationSec: 3600, passPercent: 82.6 },
  // 50 questions / 40 correct (80%) to pass, per the real CA DMV CDL General Knowledge test --
  // the one test every CDL candidate takes regardless of endorsements. The question bank also
  // covers Air Brakes/Combination Vehicles and Passenger/School Bus/Tank/HazMat endorsement
  // content (real candidates only take the specific endorsement tests they need, as separate
  // sittings) -- this mock exam blends everything into one practice sitting rather than modeling
  // each real sub-test separately, same simplification as the hub card's combined breakdown.
  // Untimed in reality (in-person at a DMV office/kiosk); 60 minutes is a generous stand-in.
  cdl: { questionCount: 50, durationSec: 3600, passPercent: 80 },
  // 25 questions / 20 correct (80%) to pass, per the real CA DMV M1/M2 motorcycle written
  // knowledge test. Untimed in reality; 60 minutes is a generous stand-in.
  motorcycle: { questionCount: 25, durationSec: 3600, passPercent: 80 },
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
    attemptId: attempt.id, examType: attempt.exam_type, mode: attempt.mode,
    questions: questionIds.map((id) => byId[id]).filter(Boolean).map(toPublicQuestion),
    answers: JSON.parse(attempt.answers), durationSec: attempt.duration_sec, startedAt: attempt.started_at,
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// "Toughest 45" question selection: ONLY questions the user is currently missing (last_result =
// 'incorrect', same current-state definition as the quiz's own missed-question picker) -- no
// backfill from the general pool. Up to config.questionCount, but can come back with fewer (or
// zero, if nothing is currently missed) -- callers must handle a shorter-than-usual, or empty,
// question set.
async function pickToughest45Questions(env, user, config) {
  const wrongRows = (await env.DB.prepare(
    `SELECT q.id FROM questions q JOIN progress p ON p.question_id = q.id
     WHERE p.user_id = ? AND p.last_result = 'incorrect' AND q.exam_type = ?
     ORDER BY RANDOM() LIMIT ?`
  ).bind(user.id, user.exam_type, config.questionCount).all()).results;
  return shuffle(wrongRows.map((r) => r.id));
}

// Regular exam's "unseen only" toggle: questions with no progress row at all for this user (never
// answered in quiz or exam). Same no-backfill rule as Toughest 45 -- up to config.questionCount,
// can come back with fewer or zero. Still recorded as a normal mode:'standard' attempt (unlike
// Toughest 45, this isn't tracked separately -- it's still a representative exam sitting, just
// biased toward coverage of the bank).
async function pickUnseenQuestions(env, user, config) {
  const rows = (await env.DB.prepare(
    `SELECT id FROM questions WHERE exam_type = ?
     AND id NOT IN (SELECT question_id FROM progress WHERE user_id = ?)
     ORDER BY RANDOM() LIMIT ?`
  ).bind(user.exam_type, user.id, config.questionCount).all()).results;
  return rows.map((r) => r.id);
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

async function findInProgressAttempt(user, env, mode) {
  const existing = await env.DB.prepare(
    `SELECT * FROM exam_attempts WHERE user_id = ? AND exam_type = ? AND mode = ? AND submitted_at IS NULL
     ORDER BY started_at DESC LIMIT 1`
  ).bind(user.id, user.exam_type, mode).first();
  if (!existing || existing.started_at + existing.duration_sec <= now()) return null;
  return existing;
}

async function handleExamCurrent(user, request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'toughest45' ? 'toughest45' : 'standard';
  const attempt = await findInProgressAttempt(user, env, mode);
  return json({ attempt: attempt ? await attemptToClientShape(env, attempt) : null });
}

async function handleExamStart(user, request, env) {
  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'toughest45' ? 'toughest45' : 'standard';
  const unseenOnly = mode === 'standard' && body.unseenOnly === true;

  // Resume rather than restart -- a refresh or re-visit mid-sitting must not hand out a
  // fresh, easier random question set or reset the clock. Tracked separately per mode, so a
  // standard exam and a Toughest 45 can each have their own in-progress sitting at once.
  // unseenOnly only affects selection at start time -- a resumed attempt just replays whatever
  // question set was already frozen, regardless of the toggle's current state.
  const existing = await findInProgressAttempt(user, env, mode);
  if (existing) return json(await attemptToClientShape(env, existing));

  const config = getExamConfig(user.exam_type);
  const questionIds = mode === 'toughest45'
    ? await pickToughest45Questions(env, user, config)
    : unseenOnly
      ? await pickUnseenQuestions(env, user, config)
      : (await env.DB.prepare('SELECT id FROM questions WHERE exam_type = ? ORDER BY RANDOM() LIMIT ?')
          .bind(user.exam_type, config.questionCount).all()).results.map((r) => r.id);
  if (!questionIds.length) return json({ error: unseenOnly ? 'no_unseen_questions' : 'no_questions' }, 404);

  const attempt = {
    id: newId(), question_ids: JSON.stringify(questionIds), answers: '{}',
    duration_sec: config.durationSec, started_at: now(), mode,
  };
  await env.DB.prepare(
    `INSERT INTO exam_attempts (id, user_id, exam_type, question_ids, answers, duration_sec, started_at, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(attempt.id, user.id, user.exam_type, attempt.question_ids, attempt.answers, attempt.duration_sec, attempt.started_at, mode).run();

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

// Lets a user abandon an in-progress attempt and start a clean one -- e.g. an interruption mid-
// sitting they don't want counted. Just deletes the row outright (by design -- the user explicitly
// wants it to vanish, not show up anywhere as an "abandoned" attempt). Safe to hard-delete with no
// other cleanup: /exam/answer only ever writes to this row's own `answers` column, so an
// unsubmitted attempt has no `progress` rows or anything else derived from it yet -- those are
// only written on submit (see handleExamSubmit). Submitted attempts can't be discarded this way;
// that's what Reset Progress is for.
async function handleExamDiscard(user, request, env) {
  const { attemptId } = await request.json();
  const attempt = await env.DB.prepare('SELECT * FROM exam_attempts WHERE id = ? AND user_id = ?').bind(attemptId, user.id).first();
  if (!attempt) return json({ error: 'attempt_not_found' }, 404);
  if (attempt.submitted_at) return json({ error: 'already_submitted' }, 400);
  await env.DB.prepare('DELETE FROM exam_attempts WHERE id = ?').bind(attemptId).run();
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

  // Feeds this attempt's per-question results into the same progress tracker quiz answers use
  // (see progressUpsertStmt) -- an unanswered question (ran out of time / skipped) is treated as
  // incorrect here too, matching how it's already scored for the exam itself.
  const progressStmts = questionIds.map((id) => byId[id] && progressUpsertStmt(env, user.id, id, answers[id], byId[id].correct_choice, submittedAt)).filter(Boolean);
  if (progressStmts.length) await env.DB.batch(progressStmts);

  const result = buildExamResult(attempt.exam_type, questionIds, answers, byId,
    correctCount, questionIds.length, attempt.started_at, submittedAt, attempt.duration_sec);

  const codeRow = await env.DB.prepare('SELECT code, buyer_email FROM codes WHERE redeemed_by = ?').bind(user.id).first();
  const modeLabel = attempt.mode === 'toughest45' ? 'Toughest 45' : 'mock';
  await notifyAdmin(env, 'Mock exam completed',
    `<p><strong>${(codeRow && (codeRow.buyer_email || codeRow.code)) || 'A user'}</strong> completed a ${attempt.exam_type} ` +
    `${modeLabel} exam: ${correctCount}/${questionIds.length} (${result.percent}%) — ${result.passed ? 'passed' : 'did not pass'}.</p>`);

  return json(result);
}

// Every submitted attempt (question set, answers, score) is already persisted in exam_attempts --
// this just surfaces it so a user can browse past sittings and revisit what they got wrong,
// reusing the same review shape buildExamResult already produces for a just-submitted exam.
// mode-scoped so Toughest 45 attempts never mix into the regular exam's history/stats or vice versa.
async function handleExamHistory(user, request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'toughest45' ? 'toughest45' : 'standard';
  const rows = (await env.DB.prepare(
    `SELECT id, exam_type, score_correct, score_total, started_at, submitted_at FROM exam_attempts
     WHERE user_id = ? AND mode = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 50`
  ).bind(user.id, mode).all()).results;
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

// ---- Promotions (admin) ---------------------------------------------------
// Full CRUD + reorder for examprep-admin's Promotions tab. See handlePromotionsList/quoteCheckout
// above for the public-facing/checkout side of this feature.

async function handleConsolePromotionsList(env) {
  const rows = (await env.DB.prepare('SELECT * FROM promotions ORDER BY sort_order ASC').all()).results;
  return json({ promotions: rows });
}

function promotionFromBody(b) {
  // A discount no longer requires a typed code -- a promo with a required_email_domain and no
  // code auto-applies whenever a matching email is entered at checkout (see
  // findActiveDomainPromoForEmail), since the domain+verification checks are the real gate and a
  // code would add no protection, just friction, for that case. A code is still supported for
  // classic secret-coupon-style promos.
  const hasCode = !!(b.promoCode && b.promoCode.trim());
  const hasDiscount = b.discountValue !== undefined && b.discountValue !== null && parseFloat(b.discountValue) > 0;
  const hasMultiplier = b.pointsMultiplier !== undefined && b.pointsMultiplier !== null && parseInt(b.pointsMultiplier, 10) > 1;
  return [
    b.title || '', b.body || '', b.ctaLabel || null, b.ctaUrl || null,
    hasCode ? normalizePromoCode(b.promoCode) : null,
    hasDiscount ? (b.discountType === 'flat_cents' ? 'flat_cents' : 'percent') : null,
    hasDiscount ? (parseInt(b.discountValue, 10) || 0) : null,
    b.requiredEmailDomain && b.requiredEmailDomain.trim() ? b.requiredEmailDomain.trim().toLowerCase() : null,
    b.requireEmailVerification ? 1 : 0,
    b.firstPurchaseOnly ? 1 : 0,
    hasMultiplier ? parseInt(b.pointsMultiplier, 10) : null,
    hasMultiplier ? (parseInt(b.pointsMultiplierDays, 10) || 30) : null,
    ['home', 'checkout', 'refer', 'both'].indexOf(b.placement) !== -1 ? b.placement : 'both',
    b.active ? 1 : 0,
  ];
}

async function handleConsolePromotionsCreate(request, env) {
  const b = await request.json();
  if (!b.title || !b.body) return json({ error: 'title_and_body_required' }, 400);
  const id = newId();
  const maxOrderRow = await env.DB.prepare('SELECT MAX(sort_order) AS m FROM promotions').first();
  const sortOrder = (maxOrderRow && maxOrderRow.m != null ? maxOrderRow.m : -1) + 1;
  await env.DB.prepare(
    `INSERT INTO promotions (id, title, body, cta_label, cta_url, promo_code, discount_type, discount_value,
       required_email_domain, require_email_verification, first_purchase_only, points_multiplier, points_multiplier_days,
       placement, active, sort_order, redeemed_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(id, ...promotionFromBody(b), sortOrder, now()).run();
  return json({ id });
}

async function handleConsolePromotionsUpdate(request, env) {
  const b = await request.json();
  if (!b.id) return json({ error: 'id_required' }, 400);
  if (!b.title || !b.body) return json({ error: 'title_and_body_required' }, 400);
  await env.DB.prepare(
    `UPDATE promotions SET title=?, body=?, cta_label=?, cta_url=?, promo_code=?, discount_type=?,
       discount_value=?, required_email_domain=?, require_email_verification=?, first_purchase_only=?,
       points_multiplier=?, points_multiplier_days=?, placement=?, active=? WHERE id = ?`
  ).bind(...promotionFromBody(b), b.id).run();
  return json({ ok: true });
}

async function handleConsolePromotionsDelete(request, env) {
  const { id } = await request.json();
  if (!id) return json({ error: 'id_required' }, 400);
  await env.DB.prepare('DELETE FROM promotions WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function handleConsolePromotionsToggle(request, env) {
  const { id, active } = await request.json();
  if (!id) return json({ error: 'id_required' }, 400);
  await env.DB.prepare('UPDATE promotions SET active = ? WHERE id = ?').bind(active ? 1 : 0, id).run();
  return json({ ok: true });
}

// Swaps sort_order with the adjacent row in the requested direction -- simplest reorder mechanic
// that doesn't need drag-and-drop wiring on the frontend. No-op (not an error) if already at the
// top/bottom edge, so a disabled-looking arrow button that still gets clicked does nothing harmful.
async function handleConsolePromotionsReorder(request, env) {
  const { id, direction } = await request.json();
  if (!id || (direction !== 'up' && direction !== 'down')) return json({ error: 'id_and_direction_required' }, 400);
  const rows = (await env.DB.prepare('SELECT id, sort_order FROM promotions ORDER BY sort_order ASC').all()).results;
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) return json({ error: 'not_found' }, 404);
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= rows.length) return json({ ok: true });
  const a = rows[index], b = rows[swapIndex];
  await env.DB.batch([
    env.DB.prepare('UPDATE promotions SET sort_order = ? WHERE id = ?').bind(b.sort_order, a.id),
    env.DB.prepare('UPDATE promotions SET sort_order = ? WHERE id = ?').bind(a.sort_order, b.id),
  ]);
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
  sql += ' ORDER BY created_at DESC LIMIT 10000';
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
  const accuracy = await env.DB.prepare(STATS_ACCURACY_BY_TOPIC_SQL).all();
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
      if (pathname === '/mcp') return await handleMcp(request, env);
      if (pathname === '/pricing' && method === 'GET') return await handlePricingGet(request, env);
      if (pathname === '/config' && method === 'GET') return await handlePublicConfig(env);
      if (pathname === '/promotions' && method === 'GET') return await handlePromotionsList(request, env);
      if (pathname === '/promotions/verify-request' && method === 'POST') return await handlePromoVerifyRequest(request, env);
      if (pathname === '/promotions/verify-email' && method === 'GET') return await handlePromoVerifyEmailConfirm(request, env);
      if (pathname === '/promotions/redeem-points-multiplier' && method === 'POST') return await handlePromoRedeemPointsMultiplier(request, env);
      if (pathname === '/paypal/create-order' && method === 'POST') return await handlePaypalCreateOrder(request, env);
      if (pathname === '/paypal/capture-order' && method === 'POST') return await handlePaypalCaptureOrder(request, env);
      if (pathname === '/stripe/create-intent' && method === 'POST') return await handleStripeCreateIntent(request, env);
      if (pathname === '/stripe/confirm' && method === 'POST') return await handleStripeConfirm(request, env);
      if (pathname === '/referrals/invite' && method === 'POST') return await handleReferralInvite(request, env);
      if (pathname === '/referrals/verify' && method === 'GET') return await handleReferralVerify(request, env);
      if (pathname === '/refunds/claim' && method === 'POST') return await handleRefundClaimSubmit(request, env);
      if (pathname === '/contact' && method === 'POST') return await handleContactSubmit(request, env);
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
        if (pathname === '/console/promotions' && method === 'GET') return await handleConsolePromotionsList(env);
        if (pathname === '/console/promotions/create' && method === 'POST') return await handleConsolePromotionsCreate(request, env);
        if (pathname === '/console/promotions/update' && method === 'POST') return await handleConsolePromotionsUpdate(request, env);
        if (pathname === '/console/promotions/delete' && method === 'POST') return await handleConsolePromotionsDelete(request, env);
        if (pathname === '/console/promotions/toggle' && method === 'POST') return await handleConsolePromotionsToggle(request, env);
        if (pathname === '/console/promotions/reorder' && method === 'POST') return await handleConsolePromotionsReorder(request, env);
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
        if (pathname === '/console/quiz-progress' && method === 'GET') return await handleConsoleQuizProgressList(env);
        if (pathname === '/console/stalled-buyers' && method === 'GET') return await handleConsoleStalledBuyersList(request, env);
        if (pathname === '/console/stalled-buyers/remind' && method === 'POST') return await handleConsoleStalledBuyerRemind(request, env);
        if (pathname === '/console/exam-attempts' && method === 'GET') return await handleConsoleExamAttemptsList(env);
        if (pathname === '/console/exam-attempts/detail' && method === 'GET') return await handleConsoleExamAttemptDetail(request, env);
        return json({ error: 'not_found' }, 404);
      }

      // Everything else requires a valid bearer token.
      const user = await requireUser(request, env);
      if (!user) return json({ error: 'unauthorized' }, 401);

      if (pathname === '/questions/next' && method === 'GET') return await handleNextQuestion(user, env, url.searchParams.get('difficulty'));
      if (pathname === '/answer' && method === 'POST') return await handleAnswer(user, request, env);
      if (pathname === '/progress' && method === 'GET') return await handleProgress(user, env);
      if (pathname === '/progress/summary' && method === 'GET') return await handleProgressSummary(user, env);
      if (pathname === '/progress/reset' && method === 'POST') return await handleProgressReset(user, request, env);
      if (pathname === '/leaderboard' && method === 'GET') return await handleLeaderboard(user, env);
      if (pathname === '/resources/progress' && method === 'GET') return await handleResourceProgressGet(user, env);
      if (pathname === '/resources/progress' && method === 'POST') return await handleResourceProgressUpdate(user, request, env);
      if (pathname === '/exam/config' && method === 'GET') return await handleExamConfig(request, env);
      if (pathname === '/exam/current' && method === 'GET') return await handleExamCurrent(user, request, env);
      if (pathname === '/exam/start' && method === 'POST') return await handleExamStart(user, request, env);
      if (pathname === '/exam/answer' && method === 'POST') return await handleExamAnswer(user, request, env);
      if (pathname === '/exam/discard' && method === 'POST') return await handleExamDiscard(user, request, env);
      if (pathname === '/exam/submit' && method === 'POST') return await handleExamSubmit(user, request, env);
      if (pathname === '/exam/history' && method === 'GET') return await handleExamHistory(user, request, env);
      if (pathname === '/exam/attempt' && method === 'GET') return await handleExamAttemptDetail(user, request, env);
      if (pathname === '/prefs' && method === 'GET') return await handlePrefsGet(user);
      if (pathname === '/prefs' && method === 'POST') return await handlePrefsSet(user, request, env);
      if (pathname === '/resources/sign-batch' && method === 'POST') return await handleResourcesSignBatch(request, env);

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'internal_error', message: err.message }, 500);
    }
  },

  // Cloudflare Cron Trigger, see wrangler.jsonc `triggers.crons` -- runs runDailyHealthCheck
  // once a day regardless of site traffic (unlike the fetch handler above, this fires even if
  // nobody visits the buy page that day, so a wiped secret gets caught before a real buyer does).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyHealthCheck(env));
  },
};
