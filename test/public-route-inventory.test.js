// GUARD: every route reachable WITHOUT a login has been reviewed for what it exposes. Added
// 2026-09-16 after an audit found three unauthenticated routes (/mcp, /sample, /resources/catalog)
// handing out paid content -- each was added for a legitimate reason, but nothing forced anyone to
// ask "what can a stranger get out of this?" when it was added.
//
// This test fails whenever a public route is added, removed, or renamed in the router, until this
// list is updated -- and updating it means writing down what the route exposes. If a new public
// route returns anything derived from questions or resources, also add it to the paid-content
// checks in security-public-endpoints.test.js (GET routes are swept automatically).
//
// Run with: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const REVIEWED_PUBLIC_ROUTES = {
  'POST /redeem': 'redeems an access code (Turnstile-gated); returns a login token only for a valid code',
  'GET /sample': 'free sample: 10 questions WITH answers from the track\'s fixed public set (min(30, 10% of bank)) -- security-public-endpoints covers it',
  'GET /qotd': 'question of the day, rotates through the track\'s public set only -- security-public-endpoints covers it',
  'ANY /mcp': 'public AI-assistant tools: sample question + grading, public set only -- security-public-endpoints covers it',
  'GET /pricing': 'prices only',
  'GET /track-key-breakdown': 'declared topic labels + percentages only',
  'GET /topic-pricing': 'topic prices only',
  'GET /config': 'public site settings',
  'GET /stats/public': 'aggregate counts only',
  'GET /stats/pass-rates-by-category': 'aggregate rates only',
  'GET /stats/quiz-accuracy-by-category': 'aggregate rates only',
  'GET /changelog': 'track mechanics change log',
  'GET /activity/recent': 'anonymized recent-activity ticker',
  'GET /category-content': 'marketing copy',
  'GET /blog': 'blog post list',
  'GET /blog/*': 'published blog post',
  'GET /questions/counts': 'question counts per track only',
  'GET /track-registry': 'track identity + exam mechanics',
  'GET /resources/catalog': 'resource metadata; content only for FREE resources -- paid-content sweep covers it',
  'GET /track-content': 'per-track disclaimer/footer prose and official links',
  'GET /promotions': 'active promo banners',
  'POST /promotions/verify-request': 'sends a promo email-verification link (Turnstile-gated)',
  'GET /promotions/verify-email': 'confirms a promo email-verification token',
  'POST /promotions/redeem-points-multiplier': 'applies a points-multiplier promo (Turnstile-gated)',
  'POST /paypal/create-order': 'checkout (Turnstile-gated)',
  'POST /paypal/capture-order': 'checkout completion, verified against the processor',
  'POST /stripe/create-intent': 'checkout (Turnstile-gated)',
  'POST /stripe/confirm': 'checkout completion, verified against Stripe',
  'POST /purchase/referral-source': 'writes "how did you hear about us" for a purchase code',
  'POST /referrals/link': 'creates/returns a referral link',
  'GET /referrals/leaderboard': 'masked referral leaderboard',
  'POST /referrals/invite': 'sends referral invites (Turnstile-gated)',
  'GET /referrals/verify': 'confirms a referral email token',
  'GET /countdown/unsubscribe': 'unsubscribe token handler',
  'POST /refunds/claim': 'submits a refund claim (Turnstile-gated)',
  'POST /contact': 'contact form (Turnstile-gated)',
  'POST /testimonials/submit': 'testimonial form (Turnstile-gated)',
  'POST /issue-reports': 'issue report widget',
  'POST /suggestions': 'suggestion widget',
  'POST /buy/reminder': 'buy-page reminder email capture',
  'POST /waitlist/join': 'track waitlist signup',
  'POST /track/visit': 'analytics beacon',
  'POST /track/event': 'analytics beacon',
  'GET /points/rules': 'referral point rules',
  'GET /points/balance': 'points balance for an email',
  'POST /points/redeem': 'starts a points redemption (email-verified)',
  'GET /points/redeem-verify': 'confirms a points redemption token',
  'GET /media/*': 'media file -- requires a valid signed URL (exp+sig), 403 otherwise',
  'GET /resources/free': 'signed URLs for FREE media files only',
};

function publicRoutesFromRouter() {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const router = src.slice(src.indexOf('export default {'));
  const publicPart = router.slice(0, router.indexOf("pathname.startsWith('/console/')"));
  const found = new Set();
  for (const m of publicPart.matchAll(/pathname === '([^']+)'(?: && method === '([A-Z]+)')?\)/g)) found.add(`${m[2] || 'ANY'} ${m[1]}`);
  for (const m of publicPart.matchAll(/pathname\.startsWith\('([^']+)\/'\) && method === '([A-Z]+)'/g)) found.add(`${m[2]} ${m[1]}/*`);
  return [...found].sort();
}

test('every unauthenticated route in the router has been reviewed (update REVIEWED_PUBLIC_ROUTES when adding one)', () => {
  const actual = publicRoutesFromRouter();
  const reviewed = Object.keys(REVIEWED_PUBLIC_ROUTES).sort();
  const unreviewed = actual.filter((r) => !reviewed.includes(r));
  const stale = reviewed.filter((r) => !actual.includes(r));
  assert.deepEqual(unreviewed, [], 'new unauthenticated route(s) not yet reviewed for what they expose: ' + unreviewed.join(', '));
  assert.deepEqual(stale, [], 'reviewed route(s) no longer in the router, remove from the list: ' + stale.join(', '));
});
