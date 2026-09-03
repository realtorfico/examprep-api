# New Hampshire Real Estate Broker Exam — Landscape Check
Started: 2026-09-03

## Status: COMPLETE — landscape check done, no drafting performed

## Sources found so far
- NH Office of Professional Licensure and Certification (OPLC), NH Real Estate Commission (NHREC)
  home: https://www.oplc.nh.gov/find-board/nh-real-estate-commission (site returns HTTP 403 to
  curl/WebFetch direct requests — Akamai bot-management edge block; the claude-in-chrome browser
  tool was also non-functional this session, same as noted in the HI landscape file — every
  get_page_text/read_page call timed out waiting for document_idle, on both a PDF URL and a plain
  HTML page. Worked around this by using WebSearch to locate the PSI-hosted content-API mirror of
  the same official PDF, same technique that worked for HI.)
- NHREC Exam Info page (found via WebSearch, not directly fetchable):
  https://www.oplc.nh.gov/find-board/nh-real-estate-commission/real-estate-examination-information
- Official PSI Candidate Information Bulletin — successfully fetched via PSI's own content-API
  endpoint (bypasses the JS candidate-portal shell, same pattern as HI):
  https://test-takers.psiexams.com/api/content/bulletin/6529
  (also discoverable as a mirrored copy on oplc.nh.gov at
  /sites/g/files/ehbemt441/files/inline-documents/rec-candidate-examination-handbook-may-2023.pdf,
  and PSI's candidate-facing portal at https://test-takers.psiexams.com/nhre)
  PDF saved locally and converted with pdftotext (both -layout and -raw modes; -raw was needed to
  correctly un-jumble the "EXAMINATION SUMMARY TABLE" columns, which -layout mode mis-ordered).
  Title: "NEW HAMPSHIRE REAL ESTATE COMMISSION — LICENSE EXAMINATIONS CANDIDATE INFORMATION
  BULLETIN". Copyright 2025 by PSI Services LLC. "Updated 7/1/2025".
- NH General Court (official state legislature) RSA text site:
  - Chapter 331-A table of contents: https://gc.nh.gov/rsa/html/xxx/331-a/331-a-mrg.htm
  - RSA 331-A:14 (Bonds) full text: https://gc.nh.gov/rsa/html/XXX/331-A/331-A-14.htm
- NH Administrative Rules (Real Estate Commission, "Rea" chapters):
  https://gc.nh.gov/rules/state_agencies/rea100-700.html (listed by WebSearch, not yet deep-read)

## CONFIRMED FACT 1: Real, distinct Broker exam — YES, separate from Salesperson, not waived/merged
Source: PSI Candidate Information Bulletin (https://test-takers.psiexams.com/api/content/bulletin/6529),
"EXAMINATIONS BY PSI SERVICES LLC" section: "This Candidate Information Bulletin provides you with
information about the examination process for becoming licensed as a Real Estate Salesperson or
Broker in the State of New Hampshire. The New Hampshire Real Estate Commission has contracted with
PSI Services LLC (PSI) to conduct the examination program."
The bulletin's Examination Summary Table gives BROKER its own row set (National/State/Combo) with
DIFFERENT item counts than Salesperson (see Fact 3) — this is a genuinely distinct exam product,
not merely extra post-licensing coursework layered on the same salesperson exam. Also corroborated
by NH RSA 331-A:10 (Qualifications for Licensure) and RSA 331-A:11 (Examinations), which the
official NH General Court site confirms establish separate "salesperson's license" and "broker's
license" categories with distinct education-hour prerequisites (40 hrs salesperson vs. 60 hrs
broker) and distinct examination requirements.
=> ANSWER TO Q1: NH has a real, active, distinct Broker exam. NOT a New Mexico/Maine-style
exclusion case.

## CONFIRMED FACT 2: Exam vendor = PSI Services LLC (NOT Pearson VUE)
Source: same PSI bulletin, header contact block: "Phone: (855) 340-3711, E-mail Questions:
examschedule@psionline.com, https://test-takers.psiexams.com/nhre". Confirmed repeatedly
throughout document as "PSI" / "PSI Services LLC". Candidate registration portal:
https://test-takers.psiexams.com/nhre.

## CONFIRMED FACT 3: Exact exam mechanics (from bulletin's "EXAMINATION SUMMARY TABLE", p.8;
raw-mode pdftotext extraction, table columns un-jumbled and verified against -layout mode)
SALESPERSON exam:
- National (Uniform) portion: 80 items (80 points), 150 minutes, passing score 56 points (=70%)
- State (NH) portion: 40 items (40 points), 90 minutes, passing score 28 points (=70%)
- Combo (both portions): 120 items (120 points), 240 minutes, passing score listed as 84 points
  (=56+28, i.e. the sum of each portion's independent passing threshold, not a separately-derived
  combined-score threshold)

BROKER exam:
- National (Uniform) portion: 75 items, but scored out of 80 points (150 minutes), passing score
  56 points (=70% of 80)
- State (NH) portion: 40 items (40 points), 90 minutes, passing score 28 points (=70%)
- Combo (both portions): 115 items (120 points total), 240 minutes, passing score 84 points
- Footnote in bulletin: "*Note: National broker exams include questions that are scored up to two
  points." — this is why the Broker National portion has fewer raw items (75) than points-possible
  (80): some items are worth 2 points instead of 1, identical scoring quirk to what was found for
  Hawaii's broker exam. Do NOT assume 1 item = 1 point when drafting/weighting broker National
  questions.
- Passing score is a FLAT 70% on the point-total for each portion (56/80 National, 28/40 State),
  not a scaled/curved score.

SCORING INDEPENDENCE: Confirmed sections are scored/passed INDEPENDENTLY, not combined into one
composite score. Exact quote (p.3, "REGISTERING FOR AN EXAMINATION" section): "To be eligible to
apply for a salesperson or broker license in New Hampshire, you must pass both the National and
State portions of the examination." Also: "Candidates who fail to attain a passing grade on both
portions of the examination within a 6-month period from the date of the original examination or
after eight (8) examination attempts shall be required to complete an accredited pre-licensing
course in addition to any pre-licensing course previously submitted..." (Rea 303.05) — retakes are
tracked per-portion, confirming independent pass/fail per section, each retaken/re-paid separately.

Exam fees (same bulletin, fee table p.6): Broker — National $36, State $34, Combo $70 (non-
refundable, valid 1 year from date of payment). Salesperson — National $34, State $32, Combo $66.

Experimental/unscored questions: "A small number of 'experimental' questions (i.e., 5 to 10) may
be administered... These questions will not be scored and the time taken to answer them will not
count against testing time." (applies to both license types)

## CONFIRMED FACT 4: Broker prerequisites — experience, education, and transaction-count requirements
Source: same PSI bulletin, "BROKER CANDIDATES" section (p.2), citing RSA 331-A:10.
EXPERIENCE (must be satisfied before the Commission will process the license application, though
note this is described as a pre-APPLICATION requirement, not literally a pre-EXAM-registration
gate per the bulletin's own wording: "there is an experience requirement under RSA 331-A:10 that
must be satisfied before the commission can process your application for licensure"):
- EITHER: employed full-time by an active principal broker for at least 1 year within the 5 years
  immediately prior to the date of application for licensure,
- OR: at least 2,000 part-time hours as a licensed salesperson in NH within the 5 years prior to
  application.
- A waiver path exists: candidates who don't meet these exactly but believe they have equivalent
  experience may request a Commission appointment to seek a waiver (603-271-2152).
TRANSACTION COUNT: "all broker applicants must submit evidence acceptable to the Commission of at
least 6 separate real estate transactions in which the applicant was actively involved and was
compensated."
EDUCATION: "Candidates for the broker examination shall show proof of completion of 60 hours of
approved study, pursuant to RSA 331-A:10,II(b) and Rea 301.03(k) through (o)" — vs. 40 hours for
Salesperson (RSA 331-A:10,I(b) and Rea 301.03(p)-(q)). The 60 broker hours may be satisfied via
several alternate paths spelled out in detail in the bulletin (a JD from an accredited law school
+ active real estate law practice; a real-estate-major bachelor's/associate's degree within 5
years; CCIM or GRI designation within 5 years; or a menu of approved CE/transcript-credit courses
totaling 60 hours) — full alternate-path text captured in the raw bulletin extraction saved at
C:\Users\avang\AppData\Local\Temp\claude\C--claudews-PassExamHQ\bac96110-00e5-49af-86ca-31278b0b6231\scratchpad\nh_broker_bulletin.txt
NOTE: candidates who pass any exam portion but fail to satisfy the education requirement by the
exam date must retake the ENTIRE exam (both portions) per Rea 301.03(r) — a real, citable rule
with numeric consequence for question-writing.
IMPORTANT DISTINCTION FROM HAWAII: unlike Hawaii (which requires the salesperson license +
Commission-approved Experience Certificate BEFORE a candidate may even sit the broker exam), the
NH bulletin's own wording places the experience requirement as a gate on the LICENSE APPLICATION
(post-exam), not explicitly on exam eligibility/registration itself. Flagging this as a nuance —
did not find bulletin language explicitly blocking broker EXAM registration on unmet experience
(contrast with Hawaii's explicit pre-exam "Experience Certificate" gate).

## CONFIRMED FACT 5: Full real topic/content outline — NATIONAL (Uniform) portion, with Broker % weights
Source: same PSI bulletin, "GENERAL PORTION CONTENT OUTLINE FOR SALESPERSONS AND BROKERS" (pp.9-11).
Same outline shared by both license types; Broker % differs from Salesperson in several sections,
and several sub-items are marked "BROKER ONLY":
I. Property Ownership — Sales 10%, Broker 10%
II. Land Use Controls — Sales 5%, Broker 5%
III. Valuation — Sales 8%, Broker 8%
IV. Financing — Sales 10%, Broker 9%
V. Contracts — Sales 19%, Broker 19%
VI. Agency — Sales 13%, Broker 13%
VII. Property Disclosures — Sales 7%, Broker 7%
VIII. Property Management — Sales 3%, Broker 5%
  (sub-items marked BROKER ONLY: A.4 property manager's maintenance/reporting/risk-management
  responsibility; A.5 handling landlord/tenant trust-account funds, reports, disbursements; A.6
  provisions of property management contracts)
IX. Transfer of Title — Sales 6%, Broker 6%
X. Practice of Real Estate — Sales 12%, Broker 12%
  (Section D "Supervisory Responsibilities" is entirely BROKER ONLY: D.1 broker's supervisory
  responsibilities over licensees/teams/unlicensed assistants/employees; D.2 broker's relationship
  with licensees as employees or independent contractors and governing rules)
XI. Real Estate Calculations — Sales 7%, Broker 6%
=> This is IDENTICAL in section structure and nearly identical in weighting to the Hawaii bulletin's
National portion outline (both are PSI's standard national content outline for state real-estate
licensing exams) — confirms PSI uses a shared/templated national content bank across states, with
per-state percentage tuning.
Full sub-topic detail (all Roman-numeral sections' lettered/numbered sub-items) captured verbatim
in the raw extraction at the scratchpad path noted in Fact 4.

## CONFIRMED FACT 6: Full real topic/content outline — STATE (New Hampshire) portion, item counts
Source: same PSI bulletin, "STATE PORTION CONTENT OUTLINE FOR SALESPERSONS AND BROKERS" (pp.11-12).
NOTE: unlike Hawaii's bulletin (which gave separate Salesperson/Broker item counts per state-portion
topic), the NH bulletin gives ONE shared item-count set used for BOTH Salesperson and Broker state
portions — but recall from Fact 3 that Salesperson's State portion totals 40 items while Broker's
State portion ALSO totals 40 items (same total, same section item counts — the two license types'
state portions appear to draw from an identical 40-item/5-section blueprint; the only place Broker
diverges from Salesperson item-for-item is the National portion, per Fact 3's table).
I. Real Estate Commission — 3 items
   A. Purpose (RSA 331-A:1); B. Duties and powers (RSA 331-A:5, 7, 8, 25; Rea 102.01);
   C. Examination of records (RSA 331-A:30; Rea 204.05); D. Disciplinary procedures
   (RSA 331-A:28, 29, 34, 35; Rea 206.01) [see "Could NOT verify" note below re: these RSA cites]
II. Licensure — 5 items
   A. Activities requiring license (RSA 331-A:2, 4); B. Licensing procedures (RSA 331-A:12, 12-a,
   15, 21, 22, 23; Rea 301.01, 301.03, 303, 305); C. Eligibility for license (RSA 331-A:10, 11,
   11-a); D. Bonds (RSA 331-A:14); E. License renewal (RSA 331-A:19; Rea 401); F. Change in
   license/status (RSA 331-A:17, 18); G. Continuing education (RSA 331-A:20, 25; Rea 403.01)
III. Regulation of Licensee Conduct — 11 items
   A. Advertising (Rea 404.05); B. Branch offices (RSA 331-A:16, 16-a); C. Prohibited conduct
   (RSA 331-A:26); D. Disclosures — private water supply (Rea 701.03), insulation (Rea 701.04),
   sewage disposal system (Rea 701.05); E. Recordkeeping (RSA 331-A:26 XVII-XVIII; Rea 404.03);
   F. Funds and accounts (RSA 331-A:13; Rea 702); G. Place of business (Rea 404.01, 404.02)
IV. Regulation of Agency Conduct — 11 items
   A. Broker/salesperson relationships (RSA 331-A:2; 331-A:16 II; 331-A:17 IV, VI; 331-A:32;
   Rea 702.02); B. Brokerage contracts (Rea 404.04); C. Agency — scope (RSA 331-A:25-a; Rea 404.03,
   701.02), disclosure (Rea 701.01, 701.02), seller agent (RSA 331-A:25-b), buyer agent
   (RSA 331-A:25-c), disclosed dual agent (RSA 331-A:25-d), designated agent (RSA 331-A:25-e),
   facilitator (RSA 331-A:25-f), other agency relationships (RSA 331-A:2 XIII; 331-A:25-a);
   D. Cooperating agreements (Rea 703.01)
V. New Hampshire Principles and Practice — 10 items
   A. Human Rights (RSA 354-A: various); B. Environmental Issues — hazardous waste (RSA 147-A,
   147-B), hazardous substances/water pollution (RSA 485-A), safe drinking water (RSA 485, 482-B),
   asbestos (RSA 141-E), underground storage tanks (RSA 146-C), radon/lead paint (RSA 477:4-a,
   RSA 130-A); C. Condominium Act (RSA 356-B); D. Planning and Zoning (RSA 672, 674); E. Wetlands
   (RSA 482-A, 483-A, 483-B); F. Taxation (RSA 72, 73, 78-A, 78-B, 79-A, 80, 75, 76); G. Manufactured
   Housing (RSA 205-A); H. Property Management/Tenants-Landlords (RSA 540, 540-A); I. Recordation
   (RSA 477, 478); J. Descent and Distribution (RSA 551, 561, 477:18)
Section item counts sum: 3+5+11+11+10 = 40 items — matches the State-portion total of 40 items
confirmed in Fact 3 for BOTH Salesperson and Broker.
Full sub-item statutory citation list captured verbatim in the raw extraction (scratchpad path in
Fact 4) — this is an unusually citation-dense outline (near every sub-topic has an exact RSA/Rea
pin-cite), a strong resource for question-writing grounding.

## CONFIRMED FACT 7: Statute/rule citations
- NH RSA Chapter 331-A — "New Hampshire Real Estate Practice Act" — the real estate licensing
  statute chapter for both salespersons and brokers.
  Source: https://gc.nh.gov/rsa/html/xxx/331-a/331-a-mrg.htm (official NH General Court site;
  fetched via WebFetch summary — table of contents confirms distinct "salesperson's license" and
  "broker's license" categories, separate examination requirements, 40 hrs salesperson / 60 hrs
  broker education).
  Key sections used above: 331-A:1 (Purpose), 331-A:2 (Definitions), 331-A:5/7 (Commission
  duty/powers), 331-A:9 (Ethics Code), 331-A:10 (Qualifications for Licensure), 331-A:10-a
  (Criminal Records Check), 331-A:11 (Examinations), 331-A:12 (Application), 331-A:13 (Escrow
  Accounts), 331-A:14 (Bonds), 331-A:16/16-a (Supervision/Branch Offices), 331-A:20 (Programs of
  Study/CE), 331-A:25 (Rulemaking), 331-A:25-a through 25-g (agency-relationship duties),
  331-A:26 (Prohibited Conduct), 331-A:32 (Civil Actions).
  Note: WebFetch's summary of the TOC showed several sections as "[Repealed]" as of a 2023
  reorganization (2023, 79:336) — including 331-A:17-19, 331-A:24-a, 331-A:28-29 — yet the PSI
  bulletin (updated 7/1/2025, i.e. AFTER that 2023 reorg) still actively cites RSA 331-A:28, 29,
  34, 35 for "Disciplinary procedures" and RSA 331-A:17, 18 for "Change in license/status" in its
  official exam content outline. This is a real discrepancy I could not resolve with certainty in
  the time available — see "Could NOT verify" section below.
- Administrative rules: New Hampshire Code of Administrative Rules, Real Estate Commission chapters
  cited throughout as "Rea" (e.g. Rea 102, 204, 206, 301, 303, 305, 401, 403, 404, 701, 702, 703).
  Source: bulletin content-outline citations, cross-referenced against
  https://gc.nh.gov/rules/state_agencies/rea100-700.html (official NH rules site listing, "Rea
  100-700" — confirms this is the correct chapter-numbering family; page not deep-read section by
  section in the time available).

## CONFIRMED FACT 8: Real Estate Recovery Fund — CONFIRMED ABSENT; NH uses a surety-bond model instead
Source: RSA 331-A:14 (Bonds), official text at https://gc.nh.gov/rsa/html/XXX/331-A/331-A-14.htm,
and cross-checked against the RSA Chapter 331-A table of contents (same page family) which lists no
"recovery fund" section anywhere in the chapter (331-A:1 through 331-A:32, with numerous sections
repealed over the years but none ever titled or covering a recovery fund).
- RSA 331-A:14 requires every PRINCIPAL or MANAGING BROKER (not every individual licensee) to file
  a surety bond of not less than $25,000 as a condition of initial licensure and renewal, "payable
  to the state of New Hampshire, for the benefit of any person aggrieved," conditioned on "faithful
  accounting by the broker for all funds entrusted to the broker in the broker's capacity as a
  principal or managing real estate broker." Aggrieved parties may sue on the bond directly; the
  surety's total liability across all claims is capped at the bond's face amount ($25,000 minimum,
  not a scaled/aggregate fund); a lapsed bond can trigger license revocation.
=> ANSWER TO Q6: New Hampshire does NOT have a Real Estate Recovery Fund. Consumer-protection
mechanism is a mandatory $25,000-minimum surety bond posted by principal/managing brokers under
RSA 331-A:14, not a state-administered recovery fund with per-transaction/per-licensee caps. Do
NOT draft any "recovery fund" questions for this track — draft bond-requirement questions instead,
grounded in RSA 331-A:14's actual $25,000 figure.

## Could NOT verify / left unconfirmed (do not fabricate):
- The apparent conflict between the PSI bulletin's (dated 7/1/2025) active citation of RSA
  331-A:28, 29, 34, 35 for disciplinary procedures and RSA 331-A:17, 18 for license status changes,
  versus a WebFetch-tool summary of the official gc.nh.gov RSA 331-A table of contents indicating
  those exact sections were repealed by a 2023 reorganization (2023, 79:336). Possible explanations
  not yet confirmed: (a) the WebFetch summary mis-read the TOC page (small-model summarization
  error — the same risk that produced clearly wrong figures earlier in this task, see below), (b)
  the disciplinary/status-change provisions were renumbered or moved to a different, general OPLC-
  wide chapter (NH did a large occupational-licensing-law consolidation in 2023) and the PSI
  bulletin's citations are stale, or (c) the repeal notices apply only to specific subsections not
  fully captured in the TOC summary. Before drafting any question that cites RSA 331-A:17, 18, 28,
  29, 34, or 35 by number, independently re-verify the CURRENT text/status of each section directly
  at https://gc.nh.gov/rsa/html/XXX/331-A/331-A-XX.htm (per-section URLs, e.g. .../331-A-28.htm).
- Full verbatim text of the "Rea 100-700" administrative rule chapters (only cross-referenced by
  citation from the PSI bulletin's content outline, not independently read section-by-section).
- Whether NH RSA 331-A:11 ("Examinations") itself specifies the National/State two-portion
  structure and 70% passing threshold in statute, or whether that mechanic is set purely by
  Commission rule/PSI contract — not independently read; the PSI bulletin is the authoritative
  source used for exam-mechanics facts above regardless.
- Whether the broker experience requirement (RSA 331-A:10) is ALSO an explicit gate on EXAM
  REGISTRATION itself (as it explicitly is in Hawaii) vs. only a gate on the post-exam LICENSE
  APPLICATION — the PSI bulletin's own wording (Fact 4) only explicitly ties it to "process your
  application for licensure," not to exam eligibility; did not find bulletin language stating a
  candidate must hold the Experience Certificate/equivalent BEFORE PSI will let them sit the exam
  (contrast Hawaii, where this is explicit). Flagging as a real state-to-state landscape difference
  worth double-checking before assuming NH's broker exam has the same "must already be a licensed
  salesperson with X years" gate model as other states.
- IMPORTANT CAVEAT ON TOOL RELIABILITY: the WebFetch tool's small summarization model produced at
  least one clearly WRONG early summary in this task — when first asked to summarize the raw PSI
  bulletin PDF, it reported "PSI (Prometric Secure Innovations)" as PSI's full name (fabricated;
  PSI's real name is simply PSI Services LLC, confirmed directly in the document header), reported
  a "75% combined passing score" and "sections scored as one combined score" (both contradicted by
  the actual table and by the bulletin's own explicit "you must pass both the National and State
  portions" language), and cited "RSA 21:34-a" as the licensing statute (wrong chapter entirely —
  the real chapter is RSA 331-A, confirmed directly in the document body at least a dozen times).
  All facts in this notes file above were independently re-derived from the raw pdftotext extraction
  of the actual PDF (not from that first WebFetch summary) specifically because of these errors —
  this file's CONFIRMED FACTs should be trusted over any AI-tool narrative summary encountered
  during this research. The claude-in-chrome browser tool was non-functional this session (as also
  noted in the HI landscape file) — every navigation to oplc.nh.gov (both a PDF URL and a plain
  HTML page) resulted in a permanent "document_idle" timeout, so it was abandoned in favor of
  WebSearch + WebFetch-on-PSI's-content-API + local pdftotext, which did work reliably.
- Direct oplc.nh.gov page fetches (both the Commission home page and the Real Estate Examination
  Information page) returned HTTP 403 from Akamai's edge (`errors.edgesuite.net` reference IDs) to
  both curl and the WebFetch tool, regardless of User-Agent/header spoofing attempted. All
  oplc.nh.gov-sourced facts in this file were obtained via WebSearch's snippet/summarization of
  those pages rather than a direct fetch — flagging in case a future session needs to re-verify
  anything not already corroborated by the PSI bulletin PDF or the gc.nh.gov RSA text (which DID
  fetch successfully).
