const fs = require("fs");
const path = require("path");

const items = [
// ===== CDL CLASSES (9) =====
{
  topic: "CDL Classifications",
  question: "What is the minimum GCWR for a New Mexico Class A CDL combination vehicle, provided the towed unit's GVWR exceeds 10,000 pounds?",
  correct: "26,001 pounds or more",
  distractors: ["10,001 pounds or more", "16,001 pounds or more", "20,001 pounds or more"],
  weight: 2,
  explanation: "New Mexico's Class A covers any combination of vehicles with a GCWR of 26,001 pounds or more, provided the GVWR of the towed vehicle(s) is in excess of 10,000 pounds.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Vehicle Groups and Endorsements - Class A"
},
{
  topic: "CDL Classifications",
  question: "Under New Mexico's CDL classification system, what may a Class A license holder do with appropriate endorsements?",
  correct: "Operate vehicles in any lesser class",
  distractors: ["Operate only Class A vehicles", "Operate only school buses", "Operate no other vehicle class"],
  weight: 1,
  explanation: "The addendum states that holders of a Class A license may, with appropriate endorsements, operate vehicles in any lesser class.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Vehicle Groups and Endorsements - Class A"
},
{
  topic: "CDL Classifications",
  question: "A New Mexico Class B CDL covers a single vehicle with a GVWR of 26,001 pounds or more, or such a vehicle towing another vehicle whose GVWR does not exceed what weight?",
  correct: "10,000 pounds",
  distractors: ["5,000 pounds", "26,001 pounds", "16,000 pounds"],
  weight: 2,
  explanation: "Class B is any single vehicle with a GVWR of 26,001 pounds or more, or such a vehicle towing a vehicle not in excess of 10,000 pounds GVWR.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Vehicle Groups and Endorsements - Class B"
},
{
  topic: "CDL Classifications",
  question: "Per New Mexico's licensing addendum, what may a Class B license holder do with appropriate endorsements?",
  correct: "Operate vehicles in any lesser class",
  distractors: ["Operate only Class A vehicles", "Never operate a Class C vehicle", "Only pull trailers under 5,000 pounds"],
  weight: 1,
  explanation: "Holders of a Class B license may, with appropriate endorsements, operate vehicles in any lesser class.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Vehicle Groups and Endorsements - Class B"
},
{
  topic: "CDL Classifications",
  question: "New Mexico's Class D covers vehicles transporting hazardous materials in placarded quantities with a GVWR under how many pounds?",
  correct: "26,000 pounds",
  distractors: ["10,000 pounds", "16,000 pounds", "33,000 pounds"],
  weight: 3,
  explanation: "Class D covers vehicles transporting hazardous materials in placarded quantities in a vehicle having a GVWR of less than 26,000 pounds (and may pull a trailer having a GVWR of less than 10,000 pounds).",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Vehicle Groups and Endorsements - Class D"
},
{
  topic: "CDL Classifications",
  question: "Besides hazmat-placarded vehicles under 26,000 pounds GVWR, what other vehicle type falls into New Mexico's Class D?",
  correct: "A vehicle designed to transport 16 or more passengers, including the driver",
  distractors: ["Any vehicle towing a trailer over 10,000 pounds", "Any straight truck over 26,001 pounds", "A doubles/triples combination"],
  weight: 3,
  explanation: "New Mexico's Class D also includes a vehicle designed to transport 16 or more passengers including the driver.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Vehicle Groups and Endorsements - Class D"
},
{
  topic: "CDL Classifications",
  question: "Per New Mexico's addendum, holders of which license class may operate all vehicles within Class D?",
  correct: "Class C",
  distractors: ["Class D only", "Class B only", "Any noncommercial license"],
  weight: 2,
  explanation: "The addendum states that holders of a Class C License may operate all vehicles within Class D.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Vehicle Groups and Endorsements - Class D"
},
{
  topic: "CDL Classifications",
  question: "Under the base AAMVA CDL manual's federal three-class framework, which class covers a small vehicle under 26,001 pounds GVWR that is used to transport 16 or more passengers or requires hazmat placarding?",
  correct: "Class C",
  distractors: ["Class D", "Class A", "Class B"],
  weight: 3,
  explanation: "Under the federal framework, Class C Small Vehicles are any single vehicle with a GVWR less than 26,001 pounds that is designed to carry 16 or more passengers, or used to transport hazmat requiring placarding.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Classifications"
},
{
  topic: "CDL Classifications",
  question: "How does New Mexico's own CDL classification addendum depart from the base federal three-class (A/B/C) framework described in the AAMVA manual's Introduction?",
  correct: "It creates a separate Class D for hazmat-placarded vehicles under 26,000 pounds GVWR and 16-or-more-passenger vehicles, which the federal manual instead folds into Class C",
  distractors: ["It eliminates Class A entirely", "It merges Class B and Class C into one class", "It removes all GVWR weight thresholds"],
  weight: 4,
  explanation: "The federal AAMVA framework places hazmat-placarded vehicles under 26,001 pounds and 16-or-more-passenger vehicles into Class C, but New Mexico's own addendum instead carves these out into a distinct fourth class, Class D.",
  source_note: "Comparison of New Mexico CDL Licensing Information (MVD-11196, Rev 8/17) and Commercial Driver's License Manual, Section 1 - Introduction, CDL Classifications"
},

// ===== ENDORSEMENTS (14) =====
{
  topic: "CDL Endorsements",
  question: "How many kinds of CDL endorsements does the Commercial Driver's License Manual's Introduction identify?",
  correct: "Six",
  distractors: ["Four", "Five", "Eight"],
  weight: 1,
  explanation: "The manual states there are six kinds of CDL endorsements that may be required, depending on the vehicle or type of cargo.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions"
},
{
  topic: "CDL Endorsements",
  question: "Per the CDL manual's Introduction, which endorsement is required for any driver, regardless of vehicle class, who wishes to haul material designated hazardous under 49 U.S.C. 5103 and required to be placarded?",
  correct: "H",
  distractors: ["N", "X", "T"],
  weight: 3,
  explanation: "Any driver, regardless of Class A, B, or C, who wishes to haul placarded hazardous materials must add a Hazardous Materials (H) endorsement to their CDL.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions - Hazardous Materials (H)"
},
{
  topic: "CDL Endorsements",
  question: "Obtaining a Hazardous Materials (H) endorsement requires a background check involving which agencies, per the manual?",
  correct: "The Transportation Security Administration (TSA) and the US Department of Transportation",
  distractors: ["The Department of Homeland Security only, with no other agency involvement", "The FBI exclusively", "The Federal Motor Carrier Safety Administration alone"],
  weight: 3,
  explanation: "The TSA and the US DOT require background checks, including review of criminal, immigration, and FBI records, on commercial drivers certified to transport hazardous materials.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions - Hazardous Materials (H)"
},
{
  topic: "CDL Endorsements",
  question: "Which endorsement is required to drive any CMV designed to transport liquid or gaseous material in a tank with an individual rated capacity of more than 119 gallons and an aggregate rated capacity of 1,000 gallons or more?",
  correct: "N (Tank Vehicle)",
  distractors: ["H", "X", "P"],
  weight: 3,
  explanation: "The Tank Vehicle (N) endorsement applies to CMVs designed to transport liquid or gaseous materials in tanks with an individual rated capacity over 119 gallons and an aggregate capacity of 1,000 gallons or more.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions - Tank Vehicle (N)"
},
{
  topic: "CDL Endorsements",
  question: "The Tank Vehicle (N) endorsement applies to Class A and B vehicles, and to Class C vehicles only under what circumstance?",
  correct: "Only if the Class C vehicle is hauling hazardous materials",
  distractors: ["Only if the driver also holds a Passenger endorsement", "Never for Class C vehicles", "Only for vehicles over 10 years old"],
  weight: 3,
  explanation: "The manual specifies the N endorsement applies to Class A, B, and C vehicles, but is only applicable to Class C if the vehicle is hauling hazardous materials.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions - Tank Vehicle (N)"
},
{
  topic: "CDL Endorsements",
  question: "A Passenger (P) endorsement is required for drivers of a vehicle with a design capacity to carry how many people, including the driver?",
  correct: "16 or more",
  distractors: ["10 or more", "20 or more", "12 or more"],
  weight: 2,
  explanation: "Drivers who wish to drive a vehicle having a design capacity to carry 16 or more people, including the driver, must add a passenger endorsement.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions - Passengers (P)"
},
{
  topic: "CDL Endorsements",
  question: "Per New Mexico's endorsement chart, what skills-test requirement applies to the Passenger (P) endorsement, in addition to its written test?",
  correct: "A skills test is required (Yes)",
  distractors: ["No skills test is required", "Only a vision test is required", "A written test only, administered twice"],
  weight: 2,
  explanation: "New Mexico's endorsement chart lists \"Yes\" under the skills test column for the endorsement covering hauling liquids in bulk/passenger transport, consistent with the AAMVA text requiring both a written exam and a skills test in a passenger vehicle.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Endorsements chart"
},
{
  topic: "CDL Endorsements",
  question: "Which endorsement is required for drivers who wish to pull double or triple trailers?",
  correct: "T (Doubles/Triples)",
  distractors: ["X", "N", "S"],
  weight: 2,
  explanation: "Drivers who are qualified to drive Class A vehicles and wish to pull double or triple trailers must add a Doubles/Triple Trailers (T) endorsement after passing a special knowledge examination.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions - Double and Triple Trailers (T)"
},
{
  topic: "CDL Endorsements",
  question: "The Combination Hazardous Materials and Tank Vehicle (X) endorsement shows that a driver has passed which knowledge examinations?",
  correct: "The special knowledge examinations for both tank vehicles and hazardous materials",
  distractors: ["Only the tank vehicle examination", "Only the hazardous materials examination", "A physical strength test"],
  weight: 3,
  explanation: "Drivers of tank vehicles who haul hazardous materials or waste in amounts requiring placards must add an X endorsement, showing they passed the special knowledge examinations for both tank vehicles and hazardous materials.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions - Combination Hazardous Materials and Tank Vehicle (X)"
},
{
  topic: "CDL Endorsements",
  question: "Drivers who wish to drive a school bus must add a School Bus (S) endorsement and, per the manual's Introduction, pass what additional requirement?",
  correct: "Skills tests in a school bus",
  distractors: ["A defensive driving certificate", "A hazmat background check", "A CPR course"],
  weight: 2,
  explanation: "School bus drivers must pass a special knowledge examination on passenger safety considerations and must also pass skills tests in a school bus.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions - School Buses (S)"
},
{
  topic: "CDL Endorsements",
  question: "Per the manual's Introduction, which three endorsements are the only ones that may be added to a Commercial Learner's Permit (CLP)?",
  correct: "Passenger (P), School Bus (S), and Tank Vehicle (N)",
  distractors: ["Hazardous Materials, Tank Vehicle, and Doubles/Triples", "School Bus, Hazardous Materials, and Passenger", "Doubles/Triples, Passenger, and Tank Vehicle"],
  weight: 3,
  explanation: "The manual expressly lists Passenger (P), School bus (S), and Tank vehicle (N) as the only endorsements that may be added to a CLP.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions"
},
{
  topic: "CDL Endorsements",
  question: "If a CLP is issued with a Passenger (P) or School Bus (S) endorsement, what restriction must it also contain?",
  correct: "The (P) - No passengers in a CMV bus restriction",
  distractors: ["The (X) - No cargo in a CMV tank vehicle restriction", "The (L) - No air brake restriction", "No restriction is required"],
  weight: 4,
  explanation: "The manual states that a CLP issued with a Passenger (P) or School Bus (S) endorsement must also contain a (P) - No passengers in a CMV bus restriction.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions"
},
{
  topic: "CDL Endorsements",
  question: "If a CLP is issued with a Tank Vehicle (N) endorsement, what restriction must it also contain?",
  correct: "The (X) - No cargo in a CMV tank vehicle restriction",
  distractors: ["The (P) restriction", "The (L) restriction", "The (K) restriction"],
  weight: 4,
  explanation: "The manual states that a CLP issued with a Tanker (N) endorsement must also contain an (X) - No cargo in a CMV tank vehicle restriction.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions"
},
{
  topic: "CDL Endorsements",
  question: "New Mexico's endorsement table lists a written test name for each endorsement. What is the written test called for the Doubles/Triples (T) endorsement?",
  correct: "Doubles/Triples",
  distractors: ["Tank Vehicle", "School bus", "Tank and Hazardous Materials"],
  weight: 1,
  explanation: "New Mexico's endorsement chart lists \"Doubles/Triples\" as the written test name corresponding to the T endorsement, with no skills test required.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Endorsements chart"
},

// ===== RESTRICTIONS (15) =====
{
  topic: "CDL Restrictions",
  question: "How many standardized restriction codes does the base federal CDL framework use, per the manual's Introduction?",
  correct: "Ten",
  distractors: ["Six", "Thirteen", "Eight"],
  weight: 2,
  explanation: "The manual's Introduction states there are ten standardized restriction codes in the federal framework.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, CDL Endorsements & Restrictions - Restrictions"
},
{
  topic: "CDL Restrictions",
  question: "New Mexico's own CDL licensing addendum adds how many restriction codes beyond the ten federal codes?",
  correct: "Three (B, C, and D)",
  distractors: ["Two (B and C)", "Five", "One (B only)"],
  weight: 3,
  explanation: "New Mexico's addendum lists thirteen total restriction codes: the ten federal codes (E, K, L, M, N, O, P, V, X, Z) plus three New Mexico-added codes, B, C, and D, covering corrective lenses, mechanical aids, and prosthetic aids.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions"
},
{
  topic: "CDL Restrictions",
  question: "What does New Mexico's restriction code B require of a driver?",
  correct: "Corrective lenses must be worn while driving",
  distractors: ["Mechanical aids must be used", "Prosthetic aids must be used", "No air brakes may be operated"],
  weight: 2,
  explanation: "New Mexico's restriction code B requires that corrective lenses be worn while driving.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - B"
},
{
  topic: "CDL Restrictions",
  question: "New Mexico's restriction code C, \"Mechanical Aids,\" limits a driver to vehicles equipped with what?",
  correct: "Suitable mechanical aids, such as special brakes, hand controls, or other adaptive devices",
  distractors: ["Automatic transmissions only", "Corrective lenses", "Air-over-hydraulic brakes"],
  weight: 2,
  explanation: "Restriction code C limits the driver to vehicles equipped with suitable mechanical aids, such as special brakes, hand controls, or other adaptive devices.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - C"
},
{
  topic: "CDL Restrictions",
  question: "New Mexico's restriction code D, \"Prosthetic Aids,\" requires a driver to do what?",
  correct: "Use prosthetic aids (other than corrective lenses) while driving",
  distractors: ["Wear corrective lenses while driving", "Use hand controls only", "Avoid operating any CMV with air brakes"],
  weight: 2,
  explanation: "Restriction code D requires the driver to use prosthetic aids, other than corrective lenses, while driving.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - D"
},
{
  topic: "CDL Restrictions",
  question: "What does federal restriction code E indicate, and how can it be removed?",
  correct: "It limits the driver to CMVs with automatic transmissions; it is removed by passing a full skills test",
  distractors: ["It limits the driver to intrastate commerce; removed by an interstate exam", "It limits the driver to tank vehicles; removed by a hazmat exam", "It bars passenger transport; removed by a passenger endorsement exam"],
  weight: 3,
  explanation: "Restriction E limits the driver to CMVs with automatic transmissions, and this restriction is removed by passing a full skills test in a manual transmission vehicle.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - E; Commercial Driver's License Manual, Section 1 - Introduction"
},
{
  topic: "CDL Restrictions",
  question: "What does restriction code K mean?",
  correct: "The driver is limited to driving a commercial vehicle in intrastate commerce only",
  distractors: ["The driver may not operate an automatic transmission CMV", "The driver may not carry passengers", "The driver may not operate a tank vehicle"],
  weight: 2,
  explanation: "Restriction K means the driver is limited to driving a commercial vehicle in intrastate commerce only.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - K"
},
{
  topic: "CDL Restrictions",
  question: "What does restriction code L mean, and how can it be removed?",
  correct: "The driver is limited to CMVs without air brakes; it is removed by passing the Air Brake Knowledge Test and a full skills test",
  distractors: ["The driver may not tow a trailer; removed by a combination vehicle exam", "The driver may not drive at night; removed by a vision exam", "The driver may not haul hazardous materials; removed by a TSA background check"],
  weight: 3,
  explanation: "Restriction L limits the driver to commercial vehicles that do not have air brakes, and this restriction is removed by passing the Air Brake Knowledge Test and the full Skills Test.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - L"
},
{
  topic: "CDL Restrictions",
  question: "What does restriction code M indicate?",
  correct: "No Class A passenger vehicle",
  distractors: ["No Class A or B passenger vehicle", "No full air brake equipped CMV", "No tractor-trailer"],
  weight: 2,
  explanation: "Restriction code M means no Class A passenger vehicle.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - M"
},
{
  topic: "CDL Restrictions",
  question: "What does restriction code N indicate?",
  correct: "No Class A or B passenger vehicle",
  distractors: ["No Class A passenger vehicle only", "No cargo in a CMV tank vehicle", "Driver limited to intrastate commerce"],
  weight: 2,
  explanation: "Restriction code N means no Class A or B passenger vehicle.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - N"
},
{
  topic: "CDL Restrictions",
  question: "What does restriction code O mean, and how can it be removed?",
  correct: "Not tractor-trailer; it is removed by passing a full skills test in a tractor-trailer",
  distractors: ["No air brakes; removed by an air brake exam", "No passengers in a CMV bus; removed by a passenger endorsement", "No manual transmission; removed by a skills test in a manual vehicle"],
  weight: 3,
  explanation: "Restriction O means not tractor-trailer, and it is removed by passing the full Skills Test in a tractor-trailer.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - O"
},
{
  topic: "CDL Restrictions",
  question: "What does restriction code P mean on a CDL permit?",
  correct: "No passengers in a CMV bus",
  distractors: ["No cargo in a CMV tank vehicle", "No tractor-trailer combinations", "Corrective lenses must be worn"],
  weight: 2,
  explanation: "Restriction P is a CDL Permit restriction meaning no passengers in a CMV bus.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - P"
},
{
  topic: "CDL Restrictions",
  question: "What does restriction code V represent?",
  correct: "A medical variance - a federal waiver or exemption for a physical or vision condition",
  distractors: ["A driver limited to vehicles under 26,000 pounds", "A driver restricted to intrastate commerce", "A driver limited to automatic transmissions"],
  weight: 3,
  explanation: "Restriction V represents a medical variance, meaning a federal waiver or exemption for a physical or vision condition.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - V"
},
{
  topic: "CDL Restrictions",
  question: "What does restriction code X mean on a CDL permit?",
  correct: "No cargo in a CMV tank vehicle",
  distractors: ["No passengers in a CMV bus", "No full air brake equipped CMV", "Mechanical aids required"],
  weight: 2,
  explanation: "Restriction X is a CDL Permit restriction meaning no cargo in a CMV tank vehicle.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - X"
},
{
  topic: "CDL Restrictions",
  question: "What does restriction code Z indicate?",
  correct: "No full air brake equipped CMV",
  distractors: ["No air brakes of any kind", "No manual transmission CMV", "No cargo in a tank vehicle"],
  weight: 2,
  explanation: "Restriction code Z means no full air brake equipped CMV.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Restrictions - Z"
},

// ===== PREQUALIFICATION (6) =====
{
  topic: "CDL/CLP Prequalification",
  question: "Per New Mexico's CDL Licensing Information addendum, what proof of lawful presence may satisfy the prequalification documentation requirement?",
  correct: "A State birth certificate, a US passport, or other proof of lawful presence in the US",
  distractors: ["Only a US passport", "A foreign driver's license alone", "A notarized letter from an employer"],
  weight: 2,
  explanation: "The first prequalification documentation item listed is a State birth certificate or US passport or other proof of lawful presence in the US.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Prequalification"
},
{
  topic: "CDL/CLP Prequalification",
  question: "Besides proof of lawful presence, what identification document must a CDL/CLP applicant provide under New Mexico's prequalification requirements?",
  correct: "A Social Security Card",
  distractors: ["A concealed carry permit", "A voter registration card", "A firearm owner's ID"],
  weight: 1,
  explanation: "The second prequalification documentation item listed is a Social Security Card.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Prequalification"
},
{
  topic: "CDL/CLP Prequalification",
  question: "How may an applicant's DOT Medical Certification be provided to satisfy New Mexico's prequalification requirements?",
  correct: "Stored electronically by MVD or as a hard copy",
  distractors: ["Only as a notarized hard copy", "Only through electronic MVD storage; hard copies are not accepted", "Verbally confirmed by the applicant's physician"],
  weight: 2,
  explanation: "The prequalification list specifies DOT Medical Certification, stored electronically by MVD or hard-copy.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Prequalification"
},
{
  topic: "CDL/CLP Prequalification",
  question: "How many verifiable proofs of physical residency in New Mexico must a CDL/CLP applicant provide?",
  correct: "Two",
  distractors: ["One", "Three", "Four"],
  weight: 2,
  explanation: "The prequalification list requires two verifiable proofs of physical residency in New Mexico.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Prequalification"
},
{
  topic: "CDL/CLP Prequalification",
  question: "What is the fifth prequalification documentation item listed for a CDL Permit, first-time Commercial License, or Commercial License renewal?",
  correct: "A valid New Mexico driver's/CDL license",
  distractors: ["A federal firearms license", "A commercial insurance binder", "An out-of-state CDL abstract"],
  weight: 1,
  explanation: "The fifth and final prequalification documentation item listed is a valid New Mexico driver's/CDL license.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Prequalification"
},
{
  topic: "CDL/CLP Prequalification",
  question: "How is each part of New Mexico's CDL Knowledge and Skills Test graded?",
  correct: "Independently, with a passing score of 80% or higher required for each part",
  distractors: ["As a combined average across all parts, requiring 70% overall", "On a pass/fail basis with no minimum score", "Independently, with a passing score of 60% or higher required"],
  weight: 4,
  explanation: "The addendum states plainly: \"Each part of the Knowledge and Skills Test is graded independently. A passing score is 80% or higher.\"",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Passing Score"
},

// ===== ELDT (8) =====
{
  topic: "Entry-Level Driver Training (ELDT)",
  question: "Beginning on what date must CDL applicants complete entry-level driver training from a registered provider before taking required skills or knowledge tests?",
  correct: "February 7, 2022",
  distractors: ["January 30, 2012", "November 13, 2023", "January 1, 2020"],
  weight: 3,
  explanation: "Beginning February 7, 2022, CDL applicants must have completed applicable entry-level driver training from a registered training provider to be eligible to take required skills or knowledge tests.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), ELDT Entry-Level Driver Training"
},
{
  topic: "Entry-Level Driver Training (ELDT)",
  question: "Registered ELDT training providers must be listed on which registry?",
  correct: "FMCSA's Training Provider Registry",
  distractors: ["The National Registry of Certified Medical Examiners", "The CDLIS driver record database", "The Transportation Security Administration registry"],
  weight: 2,
  explanation: "All entry-level drivers of CMVs must receive training from a provider listed on FMCSA's Training Provider Registry.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), ELDT Entry-Level Driver Training"
},
{
  topic: "Entry-Level Driver Training (ELDT)",
  question: "If a driver holds a CLP issued before February 7, 2022, is ELDT required?",
  correct: "No, as long as the driver obtains a CDL before the CLP expires",
  distractors: ["Yes, ELDT is always required regardless of CLP issue date", "Only if the driver is under 21", "Only if applying for a hazmat endorsement"],
  weight: 3,
  explanation: "Per the ELDT scenario chart, a driver holding a CLP issued before February 7, 2022 is not required to complete ELDT, as long as the driver obtains a CDL before the CLP expires.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), ELDT scenario chart"
},
{
  topic: "Entry-Level Driver Training (ELDT)",
  question: "A driver who was issued a CDL or an S, P, or H endorsement before February 7, 2022, is subject to what ELDT requirement for that previously-issued license or endorsement?",
  correct: "ELDT is not required, even if the license or endorsement has since lapsed",
  distractors: ["ELDT must be completed within one year of the compliance date", "ELDT is required upon any renewal", "ELDT is required only if the CDL is upgraded"],
  weight: 3,
  explanation: "The scenario chart states that a driver issued a CDL or an S, P, or H endorsement before February 7, 2022 is not required to complete ELDT for that previously-issued license or endorsement, even if it has since lapsed.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), ELDT scenario chart"
},
{
  topic: "Entry-Level Driver Training (ELDT)",
  question: "If a driver's CLP was issued before February 7, 2022, but the CLP expires before the driver applies for a CDL, what must the driver do?",
  correct: "Complete the required entry-level driver training",
  distractors: ["Nothing additional is required", "Wait one year before reapplying", "Retake only the general knowledge test"],
  weight: 3,
  explanation: "Per the scenario chart, if the CLP expires before the driver applies for a CDL, the driver must complete the required entry-level driver training.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), ELDT scenario chart"
},
{
  topic: "Entry-Level Driver Training (ELDT)",
  question: "A driver who held a CDL prior to the ELDT compliance date and applies for an upgrade to a higher class of CDL on or after February 7, 2022, must do what?",
  correct: "Complete the required entry-level driver training for the class of CDL to which the driver is upgrading",
  distractors: ["Nothing, since the driver previously held a CDL", "Only retake the road test", "Wait 90 days before upgrading"],
  weight: 3,
  explanation: "The scenario chart requires a driver upgrading to a higher class of CDL (or applying for an S, P, or H endorsement for the first time) on or after February 7, 2022 to complete the required entry-level driver training for that class or endorsement.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), ELDT scenario chart"
},
{
  topic: "Entry-Level Driver Training (ELDT)",
  question: "When must ELDT training be completed relative to testing, for a driver applying for the H endorsement?",
  correct: "Before taking the CDL skills test or the knowledge test, whichever applies",
  distractors: ["Only after passing the skills test", "Within 30 days after obtaining the endorsement", "There is no timing requirement for the H endorsement"],
  weight: 3,
  explanation: "Training must be completed before taking a CDL skills test, or if the driver is applying for the H endorsement, before the knowledge test.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), ELDT - What must drivers do to meet ELDT requirements"
},
{
  topic: "Entry-Level Driver Training (ELDT)",
  question: "What happens if a State Driver Licensing Agency cannot electronically verify that ELDT requirements are met?",
  correct: "The State is not permitted to administer the CDL skills or knowledge test to the driver",
  distractors: ["The State issues a temporary waiver", "The driver may self-certify completion instead", "The requirement is automatically waived"],
  weight: 4,
  explanation: "If the State Driver Licensing Agency cannot electronically verify that ELDT requirements are met, the State is not permitted to administer the CDL skills or knowledge test to the driver.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), ELDT - What must drivers do to meet ELDT requirements"
},

// ===== MEDICAL CERTIFICATION (7) =====
{
  topic: "Medical Certification",
  question: "Per New Mexico's addendum, what must a CDL applicant submit if they do not have a current, valid DOT Medical Certificate on record with MVD?",
  correct: "A copy of his or her medical certificate",
  distractors: ["A signed waiver of medical requirements", "Nothing; the requirement is automatically waived", "A letter from their employer"],
  weight: 2,
  explanation: "If a CDL applicant does not have a current, valid DOT Medical Certificate on record with MVD, the applicant will be required to submit a copy of his or her medical certificate.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Medical Certifications"
},
{
  topic: "Medical Certification",
  question: "Which self-certification category requires a driver to provide a current medical examiner's certificate under 49 CFR 391.45?",
  correct: "Non-excepted interstate commerce",
  distractors: ["Excepted interstate commerce", "Excepted intrastate commerce", "Intrastate excepted"],
  weight: 3,
  explanation: "Drivers operating in non-excepted interstate commerce are required to provide a current medical examiner's certificate under 49 CFR 391.45.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, Medical Documentation Requirements"
},
{
  topic: "Medical Certification",
  question: "According to the manual, most CDL holders who drive CMVs in interstate commerce fall into which self-certification category?",
  correct: "Non-excepted interstate commerce drivers",
  distractors: ["Excepted interstate commerce drivers", "Excepted intrastate commerce drivers", "Intrastate non-excepted drivers"],
  weight: 2,
  explanation: "The manual states that most CDL holders who drive CMVs in interstate commerce are non-excepted interstate commerce drivers.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, Medical Documentation Requirements"
},
{
  topic: "Medical Certification",
  question: "A driver whose only interstate activity is transporting school children and/or school staff between home and school operates under which self-certification category?",
  correct: "Excepted interstate commerce",
  distractors: ["Non-excepted interstate commerce", "Excepted intrastate commerce", "Non-excepted intrastate commerce"],
  weight: 3,
  explanation: "Transporting school children and/or school staff between home and school is listed as one of the activities that qualifies a driver as operating in excepted interstate commerce, which does not require a federal medical examiner's certificate.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, Medical Documentation Requirements"
},
{
  topic: "Medical Certification",
  question: "If you operate in both excepted interstate commerce and non-excepted interstate commerce, which status must you choose to be qualified for both?",
  correct: "Non-excepted interstate commerce",
  distractors: ["Excepted interstate commerce", "Intrastate non-excepted", "Excepted intrastate commerce"],
  weight: 3,
  explanation: "The manual states that if you operate in both excepted and non-excepted interstate commerce, you must choose non-excepted interstate commerce to be qualified to operate in both types.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, Medical Documentation Requirements"
},
{
  topic: "Medical Certification",
  question: "If you are required to have a \"certified\" medical status but fail to keep your medical examiner's certificate up to date, what happens?",
  correct: "You become \"not-certified\" and may lose your CDL",
  distractors: ["Nothing happens until your CDL is up for renewal", "You are automatically issued a medical variance", "You are downgraded to a non-excepted intrastate driver only"],
  weight: 4,
  explanation: "If you are required to have a certified medical status and fail to provide and keep up-to-date your medical examiner's certificate, you become \"not-certified\" and may lose your CDL.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, Medical Documentation Requirements"
},
{
  topic: "Medical Certification",
  question: "It is illegal to operate a CMV if a driver's blood alcohol concentration (BAC) is at or above what level?",
  correct: "0.04%",
  distractors: ["0.08%", "0.02%", "0.10%"],
  weight: 4,
  explanation: "It is illegal to operate a CMV if your blood alcohol concentration (BAC) is .04% or more.",
  source_note: "Commercial Driver's License Manual, Section 1 - Introduction, 1.3.2 Alcohol, Leaving the Scene of an Accident, and Commission of a Felony"
},

// ===== KNOWLEDGE/SKILLS RETEST RULES (6) =====
{
  topic: "Knowledge and Skills Retest Rules",
  question: "Under New Mexico's current (Rev 8/17) rule, how many times may an applicant take a CDL Knowledge Test within a 7-day period?",
  correct: "No more than two (2) times",
  distractors: ["No more than one time", "No more than three times", "No more than four times"],
  weight: 4,
  explanation: "The current Rev 8/17 addendum states the CDL Knowledge Tests can be taken no more than two (2) times in a 7 day period.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), CDL Knowledge Tests (supersedes the older Rev 12/13 figure)"
},
{
  topic: "Knowledge and Skills Retest Rules",
  question: "New Mexico's Rev 8/17 addendum's 7-day, twice-only limit on retaking a CDL Knowledge Test supersedes what earlier rule found in the older Rev 12/13 addendum?",
  correct: "A rule allowing an applicant to take any one CDL Knowledge Test up to three times within a one-year period",
  distractors: ["A rule allowing unlimited retakes with no waiting period", "A rule requiring a 30-day wait between knowledge test attempts", "A rule limiting knowledge tests to one attempt per lifetime"],
  weight: 3,
  explanation: "The older Rev 12/13 addendum allowed an applicant to take any one CDL Knowledge Test three times within a one-year period; the newer Rev 8/17 embedded text instead limits attempts to no more than two times in a 7-day period, and the current figure controls.",
  source_note: "Comparison of New Mexico CDL Licensing Information (MVD-11196, Rev 8/17 vs. Rev 12/13), CDL Knowledge Tests"
},
{
  topic: "Knowledge and Skills Retest Rules",
  question: "What happens to an applicant found cheating or committing an offense while taking a CDL test?",
  correct: "Their CDL application or CDL license is disqualified for one year from the date of determination, and if they hold a CDL, they must obtain a Class D license",
  distractors: ["They are permanently barred from ever obtaining a CDL", "They are only issued a warning", "They must pay a $500 fine and may retest immediately"],
  weight: 4,
  explanation: "Any applicant found cheating or committing an offense while testing will have their CDL application or CDL license disqualified for one year from the date of determination and will be required to obtain a Class D license if holding a CDL.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), CDL Knowledge Tests"
},
{
  topic: "Knowledge and Skills Retest Rules",
  question: "How long must an applicant wait after failing the Skills Test before retesting?",
  correct: "One week (7 days) from the day of testing",
  distractors: ["24 hours", "30 days", "There is no waiting period"],
  weight: 3,
  explanation: "Any applicant who fails the skills test must wait one week (7 days) from the day of testing before retesting.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Skills Tests"
},
{
  topic: "Knowledge and Skills Retest Rules",
  question: "How many times may a CDL applicant take the Skills Test within a one-year period, per New Mexico's addendum?",
  correct: "Three times",
  distractors: ["Two times", "Four times", "Unlimited times"],
  weight: 3,
  explanation: "Any CDL applicant may take the skills test three times within a one-year period.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Skills Tests"
},
{
  topic: "Knowledge and Skills Retest Rules",
  question: "After a third failure of the Skills Test, how long must an applicant wait before retesting, and to whom are Skills Testing fees payable?",
  correct: "One year from the first time tested; fees are payable to the third-party examiner or tester, not the State of New Mexico",
  distractors: ["90 days; fees are payable to the State of New Mexico", "One year; fees are payable to the State of New Mexico", "Six months; fees are payable to the third-party examiner"],
  weight: 4,
  explanation: "After the third fail, the applicant must wait one year from the first time tested before retesting, and all applicable fees for Skills Testing are payable to the third-party examiner or tester, not to the State of New Mexico.",
  source_note: "New Mexico CDL Licensing Information (MVD-11196, Rev 8/17), Skills Tests"
}
];

const letters = ["A", "B", "C", "D"];
const out = items.map((item, i) => {
  const correctLetter = letters[i % 4];
  const remaining = letters.filter(l => l !== correctLetter);
  const slotMap = {};
  slotMap[correctLetter] = item.correct;
  remaining.forEach((l, idx) => { slotMap[l] = item.distractors[idx]; });

  return {
    topic: item.topic,
    question: item.question,
    choice_a: slotMap["A"],
    choice_b: slotMap["B"],
    choice_c: slotMap["C"],
    choice_d: slotMap["D"],
    correct_choice: correctLetter,
    explanation: item.explanation,
    weight: item.weight,
    source_note: item.source_note
  };
});

const outPath = "C:\\claudews\\passexamhq\\Workers\\passexamhq-api\\scratchpad\\questions\\nm_cdl\\01_licensing.json";
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

console.log("Wrote", out.length, "questions");
const tally = { A: 0, B: 0, C: 0, D: 0 };
out.forEach(o => tally[o.correct_choice]++);
console.log("Tally:", JSON.stringify(tally));
