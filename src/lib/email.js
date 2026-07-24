// Transactional email via Resend (https://resend.com). Callers treat this as best-effort —
// a purchase should never fail just because the backup email couldn't be sent.

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

export async function sendCodeEmail(env, to, code, examType) {
  await sendEmail(env, {
    to,
    subject: 'Your ExamPrep access code',
    html: `<p>Thanks for your purchase! Here's your access code for the ${examType} exam prep:</p>
           <p style="font-size:1.4em;font-weight:700;letter-spacing:0.05em">${code}</p>
           <p>You're already logged in on the device you purchased from — keep this email as a backup in case you need to sign in elsewhere.</p>`,
  });
}

export async function sendReferralInviteEmail(env, to, referrerName, verifyUrl) {
  const who = referrerName ? referrerName : 'A friend';
  await sendEmail(env, {
    to,
    subject: `${who} thinks you'd like ExamPrep`,
    html: `<p>${who} referred you to ExamPrep, a California Notary exam prep site.</p>
           <p><a href="${verifyUrl}">Click here to confirm</a> — no obligation to buy anything,
           this just lets ${who} know you're a real referral.</p>
           <p>Once you're ready, you can also earn free access yourself by referring others.</p>`,
  });
}

export async function sendPointsEarnedEmail(env, to, points, reason) {
  await sendEmail(env, {
    to,
    subject: `You earned ${points} points!`,
    html: `<p>Nice — you just earned <strong>${points} points</strong> (${reason}).</p>
           <p>Redeem your points for free access once you've earned enough for a course.</p>`,
  });
}
