// Transactional email via Resend (https://resend.com). Callers treat this as best-effort —
// a purchase should never fail just because the backup email couldn't be sent.

// Was 'https://examprep.softician.com/notary' -- a stale pre-category-first-restructure domain
// and hardcoded track, fixed 2026-09-01 (found while adding a new email that needed a correct
// general site link). REDEEM_URL below already used the right domain; this didn't.
const SITE_URL = 'https://passexamhq.com/';

async function sendEmail(env, { to, subject, html, replyTo }) {
  const body = { from: 'ExamPrep <noreply@examprep.softician.com>', to, subject, html };
  if (replyTo) body.reply_to = replyTo;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`resend_failed: ${data.message || res.status}`);
  }
}

// Shared card shell for every transactional email -- table-based layout + inline styles so it
// renders consistently across clients (including Outlook's Word engine, which ignores flex/grid
// and CSS gradients). No external images/fonts: emoji + a solid brand color carry the "look".
function emailShell({ badge, title, bodyHtml, ctaText, ctaUrl, footerNote }) {
  const cta = ctaText && ctaUrl
    ? `<tr><td style="padding:8px 40px 32px;text-align:center;">
         <a href="${ctaUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;
           font-weight:700;font-size:16px;padding:14px 34px;border-radius:999px;">${ctaText}</a>
       </td></tr>`
    : `<tr><td style="padding:8px 40px 32px;"></td></tr>`;
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#eef2f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
<tr><td style="background-color:#0284c7;padding:36px 40px;text-align:center;">
<div style="font-size:44px;line-height:1;margin-bottom:8px;">${badge}</div>
<div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.01em;">${title}</div>
</td></tr>
<tr><td style="padding:28px 40px 4px;color:#0f172a;font-size:15px;line-height:1.65;">${bodyHtml}</td></tr>
${cta}
<tr><td style="padding:0 40px 28px;border-top:1px solid #e2e8f0;">
<div style="padding-top:20px;font-size:12px;color:#94a3b8;text-align:center;">${footerNote || 'ExamPrep &mdash; California Notary exam prep'}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendCodeEmail(env, to, code, examType) {
  await sendEmail(env, {
    to,
    subject: "🎉 You're in — here's your ExamPrep access code",
    html: emailShell({
      badge: '🎉',
      title: "You're in!",
      bodyHtml: `<p>Thanks for your purchase! Here's your access code for the <strong>${examType}</strong> exam prep:</p>
        <p style="text-align:center;margin:24px 0;">
          <span style="display:inline-block;background:#f0f9ff;border:2px dashed #0284c7;border-radius:10px;
            padding:14px 26px;font-size:22px;font-weight:800;letter-spacing:0.08em;color:#0284c7;">${code}</span>
        </p>
        <p>You're already logged in on the device you purchased from — keep this email as a backup in
        case you need to sign in elsewhere.</p>`,
      ctaText: 'Go to ExamPrep →',
      ctaUrl: SITE_URL,
    }),
  });
}

export async function sendReferralInviteEmail(env, to, referrerName, verifyUrl) {
  const who = referrerName ? referrerName : 'A friend';
  await sendEmail(env, {
    to,
    subject: `${who} invited you to ExamPrep 🎓`,
    html: emailShell({
      badge: '👋',
      title: `${who} thinks you'd like ExamPrep`,
      bodyHtml: `<p><strong>${who}</strong> referred you to <strong>ExamPrep</strong> — a fast, focused way
        to prep for the California Notary exam.</p>
        <p>Click below to confirm you're a real referral (no obligation to buy anything) — it just lets
        ${who} know, and you'll be free to try a sample yourself.</p>`,
      ctaText: 'Confirm & say hi →',
      ctaUrl: verifyUrl,
      footerNote: "Didn't expect this? You can safely ignore it.",
    }),
  });
}

export async function sendRedeemVerifyEmail(env, to, points, verifyUrl) {
  await sendEmail(env, {
    to,
    subject: '🔓 Confirm your free ExamPrep redemption',
    html: emailShell({
      badge: '🔓',
      title: 'One click to redeem',
      bodyHtml: `<p>You're using <strong>${points} points</strong> for free access to ExamPrep.</p>
        <p>Click below to confirm it's really you — this keeps your points safe from anyone who
        might guess your email address.</p>`,
      ctaText: 'Confirm & get my code →',
      ctaUrl: verifyUrl,
      footerNote: "Didn't request this? You can safely ignore it — your points are untouched.",
    }),
  });
}

export async function sendPromoVerifyEmail(env, to, promoTitle, verifyUrl) {
  await sendEmail(env, {
    to,
    subject: `🎓 Confirm your email for "${promoTitle}"`,
    html: emailShell({
      badge: '🎓',
      title: 'One click to unlock your discount',
      bodyHtml: `<p>You're claiming <strong>${promoTitle}</strong> at ExamPrep.</p>
        <p>Click below to confirm this is really your email — this discount is limited to
        verified addresses, so unverified emails can't apply it.</p>`,
      ctaText: 'Confirm my email →',
      ctaUrl: verifyUrl,
      footerNote: "Didn't request this? You can safely ignore it.",
    }),
  });
}

export async function sendAdminAlertEmail(env, to, title, bodyHtml, replyTo) {
  await sendEmail(env, {
    to,
    subject: `🔔 ${title}`,
    html: emailShell({
      badge: '🔔',
      title,
      bodyHtml,
      footerNote: 'Admin activity alert — change or turn this off in examprep-admin\'s Settings tab.',
    }),
    replyTo,
  });
}

export async function sendReengagementEmail(env, to, examType) {
  await sendEmail(env, {
    to,
    subject: "👋 Haven't forgotten about your exam prep?",
    html: emailShell({
      badge: '👋',
      title: 'Pick up where you left off',
      bodyHtml: `<p>You've still got full access to ExamPrep's <strong>${examType}</strong> practice question bank,
        timed mock exams, and study resources — whenever you're ready to jump back in.</p>
        <p>A little consistent practice goes a long way toward passing on your first try.</p>`,
      ctaText: 'Continue studying →',
      ctaUrl: SITE_URL,
      footerNote: "Already passed or moved on? No action needed — you won't be nudged again for a while.",
    }),
  });
}

// Free-form user text (giftMessage) goes into an HTML email body below -- escape it, unlike the
// internal/controlled strings (examType, promoTitle, etc.) every other email in this file inserts
// raw, since a gift message is the one field here a buyer could type literally anything into.
function escapeForEmail(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "Gift a track" recipient email -- the code is issued but deliberately unredeemed (see
// issueGiftCode in index.js), so this points at the redeem page rather than SITE_URL/logging
// anyone in automatically, unlike sendCodeEmail below.
const REDEEM_URL = 'https://passexamhq.com/#/redeem';

export async function sendGiftCodeEmail(env, to, code, examType, giftMessage, gifterEmail) {
  const from = gifterEmail ? escapeForEmail(gifterEmail) : 'Someone';
  await sendEmail(env, {
    to,
    subject: `🎁 ${from} sent you a gift — ExamPrep access`,
    html: emailShell({
      badge: '🎁',
      title: `${from} sent you a gift!`,
      bodyHtml: `<p>You've been gifted full access to the <strong>${examType}</strong> exam prep on ExamPrep.</p>` +
        (giftMessage ? `<p style="font-style:italic;border-left:3px solid #0284c7;padding-left:12px;margin:16px 0;">` +
          `"${escapeForEmail(giftMessage)}"</p>` : '') +
        `<p>Redeem your code below to create your own account and start studying:</p>
        <p style="text-align:center;margin:24px 0;">
          <span style="display:inline-block;background:#f0f9ff;border:2px dashed #0284c7;border-radius:10px;
            padding:14px 26px;font-size:22px;font-weight:800;letter-spacing:0.08em;color:#0284c7;">${code}</span>
        </p>`,
      ctaText: 'Redeem your code →',
      ctaUrl: REDEEM_URL,
      footerNote: "Wasn't expecting this? You can safely ignore it — the code just won't get used.",
    }),
  });
}

// Gift-purchase receipt to the BUYER (not the recipient) -- deliberately separate wording from
// sendCodeEmail below, since a gift buyer is never auto-logged-in the way a self-purchase is;
// reusing that email's "you're already logged in" copy here would be flatly wrong.
export async function sendGiftPurchaseEmail(env, to, code, examType, recipientEmail) {
  await sendEmail(env, {
    to,
    subject: '🎁 Your gift is ready to send',
    html: emailShell({
      badge: '🎁',
      title: 'Gift purchased!',
      bodyHtml: `<p>Thanks for your purchase! Here's the gift access code for the <strong>${examType}</strong> exam prep:</p>
        <p style="text-align:center;margin:24px 0;">
          <span style="display:inline-block;background:#f0f9ff;border:2px dashed #0284c7;border-radius:10px;
            padding:14px 26px;font-size:22px;font-weight:800;letter-spacing:0.08em;color:#0284c7;">${code}</span>
        </p>` +
        (recipientEmail
          ? `<p>We've already emailed this code to <strong>${escapeForEmail(recipientEmail)}</strong> on your behalf.</p>`
          : `<p>Share this code with whoever you're gifting it to — they'll enter it on the Redeem page to create their own account.</p>`) +
        `<p>Keep this email as a backup in case you need the code again.</p>`,
      ctaUrl: undefined,
      ctaText: undefined,
    }),
  });
}

// Abandoned-checkout recovery -- sent once per checkout_intents row (see index.js's
// sendAbandonedCheckoutReminders, run from the daily cron). No deep link to the exact track's buy
// page: that would need the same hand-curated kind->slug mapping (HUB_KIND_SLUGS in the site's
// app.js) that sendExamPassedEmail/the testimonial-moderation work both deliberately avoided
// duplicating server-side -- links to the homepage instead, exam name called out in the copy.
export async function sendAbandonedCheckoutEmail(env, to, examType) {
  await sendEmail(env, {
    to,
    subject: 'Still want your ' + examType + ' practice questions?',
    html: emailShell({
      badge: '👋',
      title: 'You left something behind',
      bodyHtml: `<p>Looks like you started checking out for <strong>${examType}</strong> practice questions but didn't finish.</p>
        <p>If something got in the way (a question about pricing, the guarantee, anything), just reply to this email — a real person will help.</p>`,
      ctaText: 'Finish checkout →',
      ctaUrl: SITE_URL,
      footerNote: 'Already bought elsewhere or changed your mind? No action needed.',
    }),
  });
}

export async function sendPointsEarnedEmail(env, to, points, reason) {
  await sendEmail(env, {
    to,
    subject: `🏆 You earned ${points} points!`,
    html: emailShell({
      badge: '🏆',
      title: `+${points} points!`,
      bodyHtml: `<p>Nice — you just earned <strong>${points} points</strong> (${reason}).</p>
        <p>Redeem your points for free access once you've earned enough to cover a course.</p>`,
      ctaText: 'Refer more, earn faster →',
      ctaUrl: `${SITE_URL}#/refer`,
    }),
  });
}

// Sent once, on a user's FIRST passing mock exam attempt for a given track (see the caller in
// index.js's handleExamSubmit for the "first passing attempt" dedup logic) -- a genuine positive-
// outcome moment, same trigger the in-app "You passed!" screen's own feedback prompt uses, just
// reaching them by email too since not everyone notices an on-page link.
export async function sendExamPassedEmail(env, to, examType) {
  await sendEmail(env, {
    to,
    subject: '🎉 Congrats on passing your practice exam!',
    html: emailShell({
      badge: '🎉',
      title: 'You passed!',
      bodyHtml: `<p>Nice work passing a <strong>${examType}</strong> practice exam — that's a real sign you're ready.</p>
        <p>Got a minute? A quick note about your experience helps other students trust the practice questions,
        and if you know someone else studying for the same exam, referring them earns you points too.</p>`,
      ctaText: 'Share your experience →',
      ctaUrl: `${SITE_URL}#/feedback`,
      footerNote: `Want to refer a friend instead? <a href="${SITE_URL}#/refer" style="color:#0284c7;">Refer &amp; earn →</a>`,
    }),
  });
}
