// Transactional email via Resend (https://resend.com). Callers treat this as best-effort —
// a purchase should never fail just because the backup email couldn't be sent.

const SITE_URL = 'https://examprep.softician.com/notary';

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'ExamPrep <noreply@examprep.softician.com>', to, subject, html }),
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

export async function sendAdminAlertEmail(env, to, title, bodyHtml) {
  await sendEmail(env, {
    to,
    subject: `🔔 ${title}`,
    html: emailShell({
      badge: '🔔',
      title,
      bodyHtml,
      footerNote: 'Admin activity alert — change or turn this off in examprep-admin\'s Settings tab.',
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
