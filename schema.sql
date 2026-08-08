-- examprep-api D1 schema. Apply via the D1 dashboard console (no local wrangler on this machine).

CREATE TABLE users (
  id                     TEXT PRIMARY KEY,
  exam_type              TEXT NOT NULL,
  token                  TEXT NOT NULL UNIQUE,
  theme                  TEXT NOT NULL DEFAULT 'system',
  font_scale             REAL NOT NULL DEFAULT 1.0,
  created_at             INTEGER NOT NULL,
  last_seen_at           INTEGER NOT NULL,
  last_reminder_sent_at  INTEGER                  -- last admin-sent "stalled buyer" re-engagement email
);
CREATE INDEX idx_users_token ON users(token);

CREATE TABLE codes (
  code         TEXT PRIMARY KEY,
  exam_type    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'unused', -- unused | redeemed | revoked
  note         TEXT,
  expires_at   INTEGER,                        -- epoch seconds; NULL = lifetime
  redeemed_by  TEXT REFERENCES users(id),
  redeemed_at  INTEGER,
  issued_at    INTEGER NOT NULL,
  paid_cents   INTEGER,                        -- real cash actually paid via PayPal (NULL for
                                                 -- free/points/admin-issued codes) -- refund_claims
                                                 -- computes off this, never off points value
  buyer_email  TEXT                            -- payer's email from PayPal (or their optional
                                                 -- backup email) -- best-effort, used to sanity-check
                                                 -- refund claims against who actually paid
);
CREATE INDEX idx_codes_exam_type ON codes(exam_type);

CREATE TABLE questions (
  id             TEXT PRIMARY KEY,
  exam_type      TEXT NOT NULL,
  topic          TEXT NOT NULL,
  question       TEXT NOT NULL,
  choice_a       TEXT NOT NULL,
  choice_b       TEXT NOT NULL,
  choice_c       TEXT NOT NULL,
  choice_d       TEXT NOT NULL,
  correct_choice TEXT NOT NULL, -- 'A' | 'B' | 'C' | 'D'
  explanation    TEXT NOT NULL,
  weight         INTEGER NOT NULL DEFAULT 3, -- 1-5, exam-likelihood
  source_note    TEXT, -- which handbook section/page a fact came from
  source         TEXT, -- provenance of the question itself, e.g. 'self-gen' vs a future imported batch's tag
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_questions_exam_type ON questions(exam_type);

CREATE TABLE progress (
  user_id          TEXT NOT NULL REFERENCES users(id),
  question_id      TEXT NOT NULL REFERENCES questions(id),
  times_seen       INTEGER NOT NULL DEFAULT 0,
  times_correct    INTEGER NOT NULL DEFAULT 0,
  last_result      TEXT, -- 'correct' | 'incorrect'
  last_choice      TEXT, -- 'A'|'B'|'C'|'D' the user picked on their last attempt at this question
                          -- (quiz mode only -- mock exam attempts already store full answers
                          -- separately). NULL for rows answered before this column existed.
  last_answered_at INTEGER,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX idx_progress_user ON progress(user_id);

-- Per-user consumption of study resources (audio/video/pdf/image/table), mirroring the
-- question `progress` table's shape. resource_file matches RESOURCES[...].file client-side
-- (the same stable key already used for signed URLs) -- there's no server-side resource ID
-- table, since the resource catalog itself lives in the site's app.js, not the database.
-- percent is audio/video playback progress (0-100, never decreases); pdf/image/table have no
-- meaningful "extent" so they're just marked fully consumed (100) the first time they're opened.
CREATE TABLE resource_progress (
  user_id         TEXT NOT NULL REFERENCES users(id),
  resource_file   TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  percent         INTEGER NOT NULL DEFAULT 0,
  times_opened    INTEGER NOT NULL DEFAULT 0,
  first_opened_at INTEGER NOT NULL,
  last_opened_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, resource_file)
);
CREATE INDEX idx_resource_progress_file ON resource_progress(resource_file);

-- Self-serve purchase pricing (admin-editable via examprep-admin's Settings tab).
CREATE TABLE pricing (
  exam_type   TEXT PRIMARY KEY,
  price_cents INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  updated_at  INTEGER NOT NULL
);

-- Refer & earn points. `accounts` are lightweight, email-keyed identities (no password/login) —
-- created the moment someone refers a friend, so points can accrue before any purchase happens.
CREATE TABLE accounts (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  points     INTEGER NOT NULL DEFAULT 0,
  points_multiplier            INTEGER, -- set by redeeming a points-multiplier promotion; NULL =
                                         -- no active multiplier (awardPoints treats missing/expired
                                         -- the same as 1x)
  points_multiplier_expires_at INTEGER, -- epoch seconds; awardPoints checks this on every award
                                         -- rather than clearing it eagerly, so an expired
                                         -- multiplier is just inert, not actively cleaned up
  created_at INTEGER NOT NULL
);

CREATE TABLE referrals (
  id                        TEXT PRIMARY KEY,
  referrer_account_id       TEXT NOT NULL REFERENCES accounts(id),
  referred_email            TEXT NOT NULL, -- as entered, for display/delivery
  referred_email_normalized TEXT NOT NULL UNIQUE, -- dedup key: one referral credit per inbox
                                                    -- ever, first-referrer-wins -- see
                                                    -- normalizeEmailForDedup() in index.js,
                                                    -- which folds "+tag" (and, on Gmail, dots)
                                                    -- so the same inbox can't masquerade as many.
  referred_name             TEXT,
  status                    TEXT NOT NULL DEFAULT 'invited', -- invited | verified | converted
  verify_token              TEXT NOT NULL,
  verified_at               INTEGER,
  converted_at              INTEGER,
  created_at                INTEGER NOT NULL
);

-- Generic, admin-editable list of point-earning tasks (examprep-admin's Points tab / Settings) —
-- not fixed columns, so a new earning task later is just a new row + a matching award call in
-- code, not a schema migration.
CREATE TABLE point_rules (
  task_key   TEXT PRIMARY KEY, -- 'referral_verified' | 'referral_converted' today
  label      TEXT NOT NULL,
  points     INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1, -- inactive = stop awarding without losing history
  updated_at INTEGER NOT NULL
);

-- No separate "points required per course" table: 1 point = 1 cent, so the redemption
-- threshold is just that exam type's `pricing.price_cents` — always in sync with the price.

-- Audit trail for admin manual point grants/deductions (support/bug-fix cases).
CREATE TABLE point_adjustments (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  admin_email TEXT, -- best-effort, from the already-verified Access JWT
  created_at  INTEGER NOT NULL
);

-- Bridges create-order/create-intent (which computes and quotes the discount, before payment)
-- to capture-order/confirm (which actually deducts the points, only after payment succeeds) --
-- points are never deducted just for creating an order, only for a captured one. `order_id`
-- holds either a PayPal order ID or a Stripe PaymentIntent ID, whichever processor was used.
CREATE TABLE pending_point_discounts (
  order_id        TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  points_to_apply INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

-- Generic admin-editable key/value settings -- avoids a new table/migration for every future
-- single-value knob. First use: 'min_paypal_charge_cents', the floor a points discount can
-- leave payable through PayPal (PayPal purchases can't go below $1; full coverage down to
-- $0 skips PayPal entirely via /points/redeem, so it isn't subject to this floor).
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A single timed practice-exam sitting: question set + duration are frozen at start_at so the
-- clock (server-authoritative, not client-trusted) and question list can't be gamed by
-- refreshing, and answers accumulate here so a refresh mid-sitting can resume in place.
-- One in-progress (submitted_at IS NULL) attempt per user+exam_type+mode is enforced in code, not
-- a constraint, since "in progress" also depends on whether time has run out.
CREATE TABLE exam_attempts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  exam_type     TEXT NOT NULL,
  question_ids  TEXT NOT NULL,          -- JSON array, fixes the exact set + order for this attempt
  answers       TEXT NOT NULL DEFAULT '{}', -- JSON object {questionId: choice}
  duration_sec  INTEGER NOT NULL,       -- snapshot at start, immune to later config changes
  started_at    INTEGER NOT NULL,
  submitted_at  INTEGER,
  score_correct INTEGER,
  score_total   INTEGER,
  mode          TEXT NOT NULL DEFAULT 'standard' -- 'standard' | 'toughest45' (questions drawn from
                                                  -- the user's own missed questions -- see
                                                  -- pickToughest45Questions in index.js); tracked
                                                  -- separately from 'standard' everywhere (history,
                                                  -- in-progress lookup, Progress tab) so a harder,
                                                  -- non-representative attempt never mixes into the
                                                  -- regular exam's stats.
);
CREATE INDEX idx_exam_attempts_user ON exam_attempts(user_id);

-- A free (points-covered) redemption must be confirmed by clicking a link emailed to the
-- account's address before it actually happens -- otherwise anyone who merely knows/guesses an
-- email with a points balance could redeem it for themselves. Row is claimed (deleted) atomically
-- by /points/redeem-verify, so a link can only ever be used once. Mirrors referrals.verify_token.
CREATE TABLE pending_redemptions (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  exam_type    TEXT NOT NULL,
  points       INTEGER NOT NULL, -- snapshot of the required points at request time, for display
  verify_token TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- Real-money purchase guarantees: (1) unconditional_7day -- full refund, no reason needed,
-- claimable within 7 days of purchase; (2) exam_failure_50pct -- half refund if the buyer took
-- and failed the real exam, claimable within a 180-day soft window, admin-reviewed since exam
-- results can't be verified automatically (no official lookup API exists). Computed off
-- codes.paid_cents (real cash), never off points -- a free/points-redeemed code is never
-- eligible (codes.paid_cents is NULL for those). One claim per code, ever, enforced in code.
-- Refund execution itself is manual (admin processes it in PayPal) -- this table is the queue,
-- not a payment integration.
-- Admin-configurable promotional banners (examprep-admin's Promotions tab), optionally carrying a
-- real discount code redeemable at checkout. Ordered by sort_order (admin up/down reorder);
-- placement decides where a banner shows -- 'home' | 'checkout' | 'both'. promo_code set = a real
-- discount (percent of price, or a flat cents amount) applied server-side at checkout; NULL =
-- purely informational, no pricing effect. active is a manual on/off toggle for now --
-- starts_at/ends_at are reserved for a future scheduled-activation feature, not yet enforced.
CREATE TABLE promotions (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  cta_label      TEXT,
  cta_url        TEXT,
  promo_code     TEXT,                        -- NULL = marketing-only, no real discount
  discount_type  TEXT,                        -- 'percent' | 'flat_cents', only when promo_code is set
  discount_value INTEGER,                     -- 1-100 for percent, cents for flat_cents
  required_email_domain TEXT,                 -- e.g. '.edu' -- buyer's checkout email must end
                                               -- with this (case-insensitive) for the code to
                                               -- apply; NULL = no restriction
  require_email_verification INTEGER NOT NULL DEFAULT 0, -- admin-toggleable: if set, the email
                                               -- must click a one-time confirmation link (see
                                               -- pending_promo_email_verifications) before the
                                               -- discount applies, not just match the domain
  points_multiplier      INTEGER,              -- e.g. 2 to double referral points -- an entirely
                                               -- different promo "effect" than a checkout discount
                                               -- (see awardPoints), redeemed on the Refer page, not
                                               -- checkout. NULL = not a points-multiplier promo.
                                               -- Can coexist with a checkout discount on the same
                                               -- row, though in practice each promo will set one.
  points_multiplier_days INTEGER,              -- how many days the multiplier lasts once redeemed
  placement      TEXT NOT NULL DEFAULT 'both', -- 'home' | 'checkout' | 'refer' | 'both' (both =
                                               -- home + checkout; 'refer' is its own explicit
                                               -- choice since it's a distinct page/audience)
  active         INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  starts_at      INTEGER,                      -- reserved for future scheduled activation
  ends_at        INTEGER,                      -- reserved for future scheduled activation
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_promotions_active ON promotions(active);

-- Same bridge pattern as pending_point_discounts -- a promo discount is quoted at create-
-- order/create-intent time, then re-verified (not trusted from the client) at capture/confirm
-- time, so a client can't submit a bigger discount than the server actually quoted.
CREATE TABLE pending_promo_discounts (
  order_id       TEXT PRIMARY KEY,
  promo_id       TEXT NOT NULL REFERENCES promotions(id),
  code           TEXT NOT NULL,
  discount_cents INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);

-- One-time email confirmation for promotions with require_email_verification set (e.g. a real
-- .edu student discount, not just a domain-suffix string check). A row's presence with
-- verified_at set + not yet expired is what quoteCheckout treats as "this email is allowed to use
-- this promo" -- mirrors the referrals/pending_redemptions verify-link pattern already used
-- elsewhere. Rows are never deleted on click (unlike pending_redemptions' claim-once semantics) --
-- the verified status must persist through the buyer's subsequent checkout call.
CREATE TABLE pending_promo_email_verifications (
  id           TEXT PRIMARY KEY,
  promo_id     TEXT NOT NULL REFERENCES promotions(id),
  email        TEXT NOT NULL,
  verify_token TEXT NOT NULL UNIQUE,
  verified_at  INTEGER,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX idx_promo_email_verif_lookup ON pending_promo_email_verifications(promo_id, email);

CREATE TABLE refund_claims (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL REFERENCES codes(code),
  email             TEXT NOT NULL,
  claim_type        TEXT NOT NULL, -- unconditional_7day | exam_failure_50pct
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied | refunded
  exam_date         TEXT,
  confirmation_note TEXT,          -- self-reported exam confirmation/candidate ID, not verified
  notes             TEXT,          -- claimant's free-text notes
  admin_notes       TEXT,
  refund_cents      INTEGER NOT NULL, -- computed at submission time from codes.paid_cents
  created_at        INTEGER NOT NULL,
  reviewed_at       INTEGER,
  reviewed_by       TEXT           -- admin email, best-effort from the Access JWT
);
CREATE INDEX idx_refund_claims_code ON refund_claims(code);
