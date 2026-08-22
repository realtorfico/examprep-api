# Iowa CDL question-bank build — shared brief for all bucket-writing sub-agents

## Source manual (already downloaded and converted — do not re-download)
- Official PDF: https://iowadot.gov/media/326/download?inline= (also mirrored at
  https://ia.iowadot.gov/pubs/CDL-manual.pdf) — "NATIONAL CDL MANUAL (Commercial Driver's
  License), With Supplement for Modernized Version", "2005 Testing System (2017 Version) with
  Supplemental Sections 11 and 12", Copyright 2005 AAMVA, Hy-Brid Version October 2023 (individual
  sections carry their own "Version: July 2017" / "Version: March 2025" footers).
- Plain text (pdftotext -layout): `C:\claudews\PassExamHQ\Workers\passexamhq-api\scratchpad\ia_cdl_research\ia_cdl_manual.txt`
  (9,983 lines). Read this file directly with the Read tool using offset/limit for your assigned
  line range below. It is an AAMVA-authored generic national manual (same base text used by other
  states in this project such as Idaho), with a handful of Iowa-specific insertions you should
  watch for and use (e.g. "In Iowa, no Class A passenger vehicles are allowed" near line 595/604;
  "Verbally describe only, no physical demonstration will be required in Iowa" near line 8694).

## Official Iowa DOT exam-mechanics facts (verified directly from iowadot.gov, cite these exactly
## — do not invent or borrow numbers from another state)

Source: https://iowadot.gov/drivers-licenses-ids/commercial-drivers/get-cdl/cdl-testing
"Types of CDL knowledge tests (number of questions/allowed to miss)":
- General knowledge for any CDL: 50 questions / 10 allowed to miss (40 correct to pass, 80%)
- Combination vehicle for Class A: 20 questions / 4 allowed to miss (16 correct, 80%)
- Air brake: 25 questions / 5 allowed to miss (20 correct, 80%)
- Passenger: 20 questions / 4 allowed to miss (16 correct, 80%)
- School bus: 20 questions / 4 allowed to miss (16 correct, 80%)
- Doubles/Triples: 20 questions / 4 allowed to miss (16 correct, 80%)
- Hazmat: 30 questions / 6 allowed to miss (24 correct, 80%)
- Tank: 20 questions / 4 allowed to miss (16 correct, 80%)
- Iowa operator (if applicable): 25 questions / 5 allowed to miss (20 correct, 80%)
Every test computes to exactly the federally standardized 80% minimum passing score (49 CFR
383.135(a)). Tests are taken at "any DOT or County Treasurer location" by appointment, or
additional CDL Testing Locations.

Source: https://iowadot.gov/drivers-licenses-ids/commercial-drivers/get-cdl
Four-step process: (1) Pass CDL knowledge tests for your vehicle type, (2) Obtain a commercial
learner's permit (CLP), (3) Complete entry-level driver training (ELDT), (4) Pass the CDL skills
and drive test. Minimum age 18; must be 21 to operate a CMV in interstate commerce. Must provide
proof of full name/DOB/SSN, proof of citizenship, Iowa residency proof, pass vision screening,
pass an interstate driving record check, and certify how the CMV will be used (may require a
medical certificate).

Source: https://iowadot.gov/drivers-licenses-ids/commercial-drivers/get-cdl/commercial-learner-permits-clp
CLP needed when applying for a CDL for the first time (or after being without one for a year), or
upgrading a class requiring a new skills test. CLP costs $12, valid 1 year from issuance, no
renewal. Must hold a CLP at least 14 days (and complete ELDT if applicable) before the skills/drive
test. CLP holder must always be accompanied by a CDL holder valid for that vehicle type; may not
drive solo, use a cell phone while driving, carry passengers (other than required personnel), haul
hazmat, or operate a tank vehicle.

Source: https://iowadot.gov/drivers-licenses-ids/get-or-renew-drivers-licenses-ids-permits/fees
CDL Class A/B/C: $8/year, issued for 8 years (so $64 for a full 8-year CDL; note persons age 78+
get a 2-year-only issuance). CLP: $12, 1 year. Endorsement addition fees (outside of renewal):
Doubles/triples, Tank vehicles, Hazardous materials: $5 each. Passenger, School bus: $10 each.
Combined Haz-mat/Tank (X): $10 (requires passing both the tanker and hazmat exams, plus a
fingerprint-based TSA threat assessment). Restriction removal: $10 each (may require a pre-trip
inspection test or a skills/driving test).

## DO NOT USE any question-count/passing-score numbers except the ones listed above. If you need
a fact not covered above or in your assigned manual excerpt, either skip it or note the gap — do
not borrow numbers from Illinois, Idaho, or any other state's build.

## Schema — every question object (exact field names, matches scripts/tracks/il_cdl.json pipeline)
```json
{
  "topic": "Short topic/subsection label, Title Case",
  "question": "Full question text, self-contained, no 'per the manual' phrasing",
  "choice_a": "...",
  "choice_b": "...",
  "choice_c": "...",
  "choice_d": "...",
  "correct_choice": "A" | "B" | "C" | "D",
  "explanation": "1-3 sentences explaining why the correct answer is correct, grounded in the source",
  "weight": 1-5 (integer; use 3 as the default/typical, 5 for safety-critical/high-stakes facts, 1-2 for minor/detail facts),
  "source_note": "Iowa Commercial Driver's License Manual (National CDL Manual, 2005 Testing System / 2017 Modernized Version, with Supplemental Sections 11 and 12; Iowa Department of Transportation) -- Section N.n, <subsection title>"
}
```
- All 4 choices must be distinct (case-insensitive) — never two choices that normalize the same.
- `correct_choice` must be exactly one of "A"/"B"/"C"/"D".
- Every question must be grounded in a specific passage from your assigned manual excerpt (or the
  official exam-mechanics facts above for the licensing/mechanics bucket) — cite the specific
  section/subsection number in source_note. No invented facts, no generic "common knowledge"
  padding, no questions duplicated/near-duplicated within your file.
- Output file: a single JSON array (top-level `[...]`) of question objects, valid JSON (verify it
  parses), written to the exact path given in your assignment.
- Quality over quantity: if a thin section genuinely doesn't support your target count without
  padding or repetition, write fewer — do not pad.

## When done
Report back: file path written, question count, any facts you could not ground and had to skip.
Do NOT touch any other bucket file, any other state's files, or run any build scripts. Only write
your one assigned JSON file.
