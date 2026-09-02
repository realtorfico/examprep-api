// Generator for 10_real_estate_finance_mortgages_extra.json
const fs = require('fs');

function money(n) {
  n = Math.round(n * 100) / 100;
  const neg = n < 0;
  n = Math.abs(n);
  let s;
  if (Number.isInteger(n)) {
    s = n.toLocaleString('en-US');
  } else {
    s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return (neg ? '-$' : '$') + s;
}

function pct(n) {
  n = Math.round(n * 1000) / 1000;
  return (Number.isInteger(n) ? n : parseFloat(n.toFixed(3))).toString() + '%';
}

const TOPIC = 'Real Estate Finance & Mortgages';
const out = [];
const seenQ = new Set();
function push(q) {
  if (seenQ.has(q.question)) throw new Error('DUPLICATE QUESTION TEXT: ' + q.question);
  seenQ.add(q.question);
  const choices = [q.choice_a, q.choice_b, q.choice_c, q.choice_d];
  if (!choices.every((c, i, arr) => arr.indexOf(c) === i)) {
    throw new Error('DUPLICATE CHOICE within question: ' + q.question);
  }
  if (q.correct_choice !== 'A') throw new Error('correct_choice must be A (draft convention): ' + q.question);
  out.push(q);
}

// =========================================================================
// CATEGORY 1: Loan-to-Value (LTV) ratio -- 28 questions
// =========================================================================

// 1a: solve for LTV% given purchase price/value (V) and loan amount (L) -- 8
const ltv1a = [
  [200000, 80], [250000, 75], [320000, 90], [400000, 70],
  [180000, 95], [450000, 85], [600000, 60], [350000, 96.5]
];
for (const [V, p] of ltv1a) {
  const L = V * p / 100;
  const wrongB = 100 - p; // confused LTV with down-payment %
  const wrongC = Math.round((V / L * 100) * 10) / 10; // inverted value/loan
  const wrongD = Math.round((p * 0.85) * 10) / 10; // understated ratio
  push({
    topic: TOPIC,
    question: `A property is purchased for ${money(V)} and the buyer obtains a loan of ${money(L)}. What is the loan-to-value (LTV) ratio?`,
    choice_a: pct(p),
    choice_b: pct(wrongB),
    choice_c: pct(wrongC),
    choice_d: pct(wrongD),
    correct_choice: 'A',
    explanation: `LTV = Loan amount / Value = ${money(L)} / ${money(V)} = ${pct(p)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (LTV formula, applied)'
  });
}

// 1b: solve for maximum loan amount given V and target LTV% -- 8
const ltv1b = [
  [275000, 80], [330000, 90], [410000, 75], [500000, 85],
  [225000, 95], [600000, 70], [720000, 80], [1200000, 65]
];
for (const [V, p] of ltv1b) {
  const L = V * p / 100;
  const wrongB = V - L; // gave the down payment instead
  const wrongC = V * (p + 10) / 100;
  const wrongD = V * (p - 10) / 100;
  push({
    topic: TOPIC,
    question: `A lender will approve financing up to ${pct(p)} LTV on a property valued at ${money(V)}. What is the maximum loan amount the lender will approve?`,
    choice_a: money(L),
    choice_b: money(wrongB),
    choice_c: money(wrongC),
    choice_d: money(wrongD),
    correct_choice: 'A',
    explanation: `Maximum loan = Value x target LTV = ${money(V)} x ${pct(p)} = ${money(L)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (LTV formula, applied)'
  });
}

// 1c: solve for required down payment $ given V and target LTV% -- 6
const ltv1c = [
  [260000, 80], [340000, 90], [480000, 75],
  [600000, 95], [150000, 85], [825000, 70]
];
for (const [V, p] of ltv1c) {
  const L = V * p / 100;
  const D = V - L;
  const wrongB = L; // gave loan amount instead of down payment
  const wrongC = V - (V * (p + 10) / 100);
  const wrongD = D * 2;
  push({
    topic: TOPIC,
    question: `A buyer wants to finance a ${money(V)} purchase at no more than ${pct(p)} LTV. How much cash down payment is required?`,
    choice_a: money(D),
    choice_b: money(wrongB),
    choice_c: money(wrongC),
    choice_d: money(wrongD),
    correct_choice: 'A',
    explanation: `Down payment = Value - maximum loan = ${money(V)} - (${money(V)} x ${pct(p)}) = ${money(V)} - ${money(L)} = ${money(D)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (LTV formula, applied)'
  });
}

// 1d: solve for LTV% given V and down payment $ -- 3
const ltv1d = [
  [300000, 60000], [450000, 45000], [220000, 55000]
];
for (const [V, D] of ltv1d) {
  const L = V - D;
  const p = L / V * 100;
  const wrongB = D / V * 100; // gave down-payment % instead of LTV%
  const wrongC = Math.round((p + 8) * 10) / 10;
  const wrongD = Math.round((p - 8) * 10) / 10;
  push({
    topic: TOPIC,
    question: `A buyer purchases a home for ${money(V)} and makes a cash down payment of ${money(D)}, financing the rest. What is the resulting LTV ratio?`,
    choice_a: pct(p),
    choice_b: pct(wrongB),
    choice_c: pct(wrongC),
    choice_d: pct(wrongD),
    correct_choice: 'A',
    explanation: `Loan amount = ${money(V)} - ${money(D)} = ${money(L)}. LTV = ${money(L)} / ${money(V)} = ${pct(p)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (LTV formula, applied)'
  });
}

// 1e: solve for value V given loan L and LTV% -- 3
const ltv1e = [
  [240000, 80], [337500, 75], [342000, 90]
];
for (const [L, p] of ltv1e) {
  const V = L / (p / 100);
  const wrongB = L * (p / 100); // inverted operation
  const wrongC = V + L * 0.1;
  const wrongD = V - L * 0.1;
  push({
    topic: TOPIC,
    question: `A borrower's loan amount of ${money(L)} represents ${pct(p)} LTV. What is the property's value?`,
    choice_a: money(V),
    choice_b: money(wrongB),
    choice_c: money(wrongC),
    choice_d: money(wrongD),
    correct_choice: 'A',
    explanation: `Value = Loan amount / LTV = ${money(L)} / ${pct(p)} = ${money(L)} / ${p / 100} = ${money(V)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (LTV formula, applied)'
  });
}

// =========================================================================
// CATEGORY 2: Mortgage points -- 26 questions
// =========================================================================

// 2a: dollar cost given loan amount and points -- 8
const pts2a = [
  [150000, 1], [220000, 1.5], [300000, 2], [380000, 0.5],
  [425000, 2.5], [500000, 3], [600000, 1.5], [720000, 2]
];
for (const [loan, points] of pts2a) {
  const cost = loan * points / 100;
  const wrongB = loan * points / 10; // treated point as 10% instead of 1%
  const wrongC = loan / points; // inverted
  const wrongD = cost * 2;
  push({
    topic: TOPIC,
    question: `A borrower pays ${points} point${points === 1 ? '' : 's'} on a ${money(loan)} loan. How much does this cost in dollars?`,
    choice_a: money(cost),
    choice_b: money(wrongB),
    choice_c: money(wrongC),
    choice_d: money(wrongD),
    correct_choice: 'A',
    explanation: `1 point = 1% of the loan amount, so ${points} point${points === 1 ? '' : 's'} = ${points}% x ${money(loan)} = ${money(cost)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (mortgage points formula, applied)'
  });
}

// 2b: points given loan amount and dollar cost -- 6
const pts2b = [
  [200000, 3000], [350000, 7000], [275000, 6875],
  [480000, 8400], [410000, 12300], [540000, 4050]
];
for (const [loan, cost] of pts2b) {
  const points = Math.round(cost / loan * 100 * 10000) / 10000;
  const wrongB = cost / loan * 10; // decimal error
  const wrongC = loan / cost; // inverted
  const wrongD = points + 1;
  push({
    topic: TOPIC,
    question: `A borrower pays ${money(cost)} at closing to buy down the rate on a ${money(loan)} loan. How many points did the borrower pay?`,
    choice_a: `${points} point${points === 1 ? '' : 's'}`,
    choice_b: `${Number(wrongB.toFixed(2))} points`,
    choice_c: `${Number(wrongC.toFixed(2))} points`,
    choice_d: `${Number(wrongD.toFixed(2))} points`,
    correct_choice: 'A',
    explanation: `Points = (dollar cost / loan amount) x 100 = (${money(cost)} / ${money(loan)}) x 100 = ${points} points.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (mortgage points formula, applied)'
  });
}

// 2c: loan amount given points and dollar cost -- 6
const pts2c = [
  [1, 2500], [1.5, 5250], [2, 8000],
  [2.5, 11250], [0.5, 1000], [3, 18000]
];
for (const [points, cost] of pts2c) {
  const loan = cost / (points / 100);
  const wrongB = cost * points; // inverted operation
  const wrongC = loan / 2;
  const wrongD = loan * 2;
  push({
    topic: TOPIC,
    question: `A lender charges ${points} point${points === 1 ? '' : 's'}, which costs the borrower ${money(cost)} at closing. What is the loan amount?`,
    choice_a: money(loan),
    choice_b: money(wrongB),
    choice_c: money(wrongC),
    choice_d: money(wrongD),
    correct_choice: 'A',
    explanation: `Loan amount = dollar cost / (points / 100) = ${money(cost)} / ${points / 100} = ${money(loan)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (mortgage points formula, applied)'
  });
}

// 2d: rate-buydown scenarios -- 6 (3 asking dollar cost, 3 asking resulting rate)
// convention used: each point paid reduces the note rate by 0.25%
const pts2dCost = [
  [300000, 2, 7.0], [400000, 1, 6.75], [250000, 3, 7.25]
];
for (const [loan, points, startRate] of pts2dCost) {
  const cost = loan * points / 100;
  const newRate = Math.round((startRate - 0.25 * points) * 1000) / 1000;
  const wrongB = loan * points / 10;
  const wrongC = cost / 2;
  const wrongD = cost * 1.5;
  push({
    topic: TOPIC,
    question: `A lender will reduce a loan's note rate by 0.25% for each point the borrower pays at closing. The borrower buys down the rate on a ${money(loan)} loan by paying ${points} point${points === 1 ? '' : 's'}. How much does this cost in dollars?`,
    choice_a: money(cost),
    choice_b: money(wrongB),
    choice_c: money(wrongC),
    choice_d: money(wrongD),
    correct_choice: 'A',
    explanation: `Cost = ${points} point${points === 1 ? '' : 's'} x 1% x ${money(loan)} = ${money(cost)} (this buydown would also lower the note rate from ${pct(startRate)} to ${pct(newRate)}, at 0.25% per point).`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (mortgage points / rate buydown, applied)'
  });
}
const pts2dRate = [
  [600000, 1.5, 6.5], [180000, 2, 7.0], [720000, 2.5, 6.75]
];
for (const [loan, points, startRate] of pts2dRate) {
  const cost = loan * points / 100;
  const newRate = Math.round((startRate - 0.25 * points) * 1000) / 1000;
  const wrongB = Math.round((startRate - 0.5 * points) * 1000) / 1000;
  const wrongC = startRate;
  const wrongD = Math.round((startRate + 0.25 * points) * 1000) / 1000;
  push({
    topic: TOPIC,
    question: `A lender reduces a loan's note rate by 0.25% for each point paid at closing. A borrower with a starting quoted rate of ${pct(startRate)} on a ${money(loan)} loan pays ${points} point${points === 1 ? '' : 's'} (${money(cost)}) to buy down the rate. What is the resulting note rate?`,
    choice_a: pct(newRate),
    choice_b: pct(wrongB),
    choice_c: pct(wrongC),
    choice_d: pct(wrongD),
    correct_choice: 'A',
    explanation: `Rate reduction = ${points} point${points === 1 ? '' : 's'} x 0.25% = ${pct(Math.round(0.25 * points * 1000) / 1000)}. New rate = ${pct(startRate)} - ${pct(Math.round(0.25 * points * 1000) / 1000)} = ${pct(newRate)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (mortgage points / rate buydown, applied)'
  });
}

// =========================================================================
// CATEGORY 3: Qualifying (debt-to-income) ratios -- 25 questions
// =========================================================================

// 3a: front-end (housing) ratio given income and PITI -- 7
const r3a = [
  [4800, 25], [5200, 28], [6000, 30], [6500, 31], [7000, 26], [7500, 29], [8000, 32]
];
for (const [I, ratio] of r3a) {
  const PITI = I * ratio / 100;
  const wrongB = PITI * 1.15;
  const wrongC = I / PITI; // inverted, nonsensical but plausible-looking distractor if formatted as %... use as pct instead
  const wrongD = ratio + 5; // will format separately below actually need consistent type
  push({
    topic: TOPIC,
    question: `A borrower has gross monthly income of ${money(I)} and a proposed monthly PITI (principal, interest, taxes, insurance) payment of ${money(PITI)}. What is the borrower's front-end (housing) qualifying ratio?`,
    choice_a: pct(ratio),
    choice_b: pct(Math.round((ratio + 6) * 10) / 10),
    choice_c: pct(Math.round((ratio - 6) * 10) / 10),
    choice_d: pct(Math.round((ratio + 12) * 10) / 10),
    correct_choice: 'A',
    explanation: `Front-end ratio = Monthly PITI / Gross monthly income = ${money(PITI)} / ${money(I)} = ${pct(ratio)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (front-end/housing qualifying ratio, applied)'
  });
}

// 3b: back-end (total debt) ratio given income, PITI, and other debt -- 7
const r3b = [
  [5000, 1300, 500], [5600, 1528, 600], [6200, 1880, 600], [6800, 1644, 600],
  [7200, 2196, 900], [7800, 2086, 800], [9000, 2250, 900]
];
for (const [I, PITI, OD] of r3b) {
  const total = PITI + OD;
  const ratio = total / I * 100;
  push({
    topic: TOPIC,
    question: `A borrower has gross monthly income of ${money(I)}, a proposed monthly PITI payment of ${money(PITI)}, and other recurring monthly debt payments (auto loan, credit cards, student loans) totaling ${money(OD)}. What is the borrower's back-end (total debt) qualifying ratio?`,
    choice_a: pct(ratio),
    choice_b: pct(PITI / I * 100),
    choice_c: pct(Math.round((ratio + 7) * 10) / 10),
    choice_d: pct(Math.round((ratio - 7) * 10) / 10),
    correct_choice: 'A',
    explanation: `Back-end ratio = (Monthly PITI + other monthly debt) / Gross monthly income = (${money(PITI)} + ${money(OD)}) / ${money(I)} = ${money(total)} / ${money(I)} = ${pct(ratio)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (back-end/total-debt qualifying ratio, applied)'
  });
}

// 3c: max PITI given income and front-end limit -- 6
const r3c = [
  [5400, 28], [6000, 31], [6600, 28], [7400, 31], [8200, 28], [9600, 31]
];
for (const [I, limit] of r3c) {
  const maxPITI = I * limit / 100;
  push({
    topic: TOPIC,
    question: `A lender applies a maximum front-end (housing) qualifying ratio of ${pct(limit)}. If the borrower's gross monthly income is ${money(I)}, what is the maximum monthly PITI payment the borrower can qualify for?`,
    choice_a: money(maxPITI),
    choice_b: money(I / limit),
    choice_c: money(maxPITI * 1.2),
    choice_d: money(maxPITI * 0.8),
    correct_choice: 'A',
    explanation: `Maximum PITI = Gross monthly income x front-end ratio limit = ${money(I)} x ${pct(limit)} = ${money(maxPITI)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (qualifying ratio formula, applied); front-end benchmarks commonly cited: ~28% conventional, ~31% FHA'
  });
}

// 3d: max total debt given income and back-end limit -- 5
const r3d = [
  [6400, 36], [7000, 43], [7600, 36], [8400, 43], [9200, 36]
];
for (const [I, limit] of r3d) {
  const maxDebt = I * limit / 100;
  push({
    topic: TOPIC,
    question: `A lender applies a maximum back-end (total debt) qualifying ratio of ${pct(limit)}. If the borrower's gross monthly income is ${money(I)}, what is the maximum total monthly debt payment (housing plus all other debts) the borrower can carry and still qualify?`,
    choice_a: money(maxDebt),
    choice_b: money(I / limit),
    choice_c: money(maxDebt * 1.2),
    choice_d: money(maxDebt * 0.8),
    correct_choice: 'A',
    explanation: `Maximum total monthly debt = Gross monthly income x back-end ratio limit = ${money(I)} x ${pct(limit)} = ${money(maxDebt)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (qualifying ratio formula, applied); back-end benchmarks commonly cited: ~36% conventional, ~43% FHA'
  });
}

// =========================================================================
// CATEGORY 4: Amortization / interest math -- 18 questions
// =========================================================================

// 4a: first month's interest = principal x annual rate / 12 -- 6
const am4a = [
  [180000, 6], [240000, 6.5], [300000, 5.5], [360000, 7], [420000, 6.5], [480000, 6.5]
];
for (const [P, rate] of am4a) {
  const interest = P * (rate / 100) / 12;
  const wrongB = P * (rate / 100); // forgot to divide by 12
  const wrongC = P * (rate / 100) / 6; // divided by 6 instead of 12
  const wrongD = interest * 3;
  push({
    topic: TOPIC,
    question: `A borrower closes on a new ${money(P)} mortgage with a ${pct(rate)} annual interest rate. Using simple monthly interest on the outstanding balance, how much of the very first month's payment is interest?`,
    choice_a: money(interest),
    choice_b: money(wrongB),
    choice_c: money(wrongC),
    choice_d: money(wrongD),
    correct_choice: 'A',
    explanation: `Monthly interest = Principal balance x (annual rate / 12) = ${money(P)} x (${pct(rate)} / 12) = ${money(P)} x ${(rate / 100 / 12).toFixed(5)} = ${money(interest)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (declining-balance monthly interest formula, applied)'
  });
}

// 4b: principal portion of first payment given balance, payment, and 6% rate -- 5
const am4b = [
  [200000, 1300], [150000, 900], [350000, 2400], [275000, 1900], [420000, 2900]
];
for (const [bal, payment] of am4b) {
  const rate = 6;
  const interest = bal * (rate / 100) / 12;
  const principalPortion = payment - interest;
  push({
    topic: TOPIC,
    question: `A borrower has a mortgage balance of ${money(bal)} at a 6% annual interest rate and makes a monthly payment of ${money(payment)}. How much of that payment goes toward reducing principal?`,
    choice_a: money(principalPortion),
    choice_b: money(interest),
    choice_c: money(payment),
    choice_d: money(principalPortion * 1.5),
    correct_choice: 'A',
    explanation: `Interest portion = ${money(bal)} x (6% / 12) = ${money(interest)}. Principal portion = payment - interest = ${money(payment)} - ${money(interest)} = ${money(principalPortion)}.`,
    weight: 3,
    source_note: 'hedge: standard real estate finance math (declining-balance monthly interest/principal split, applied)'
  });
}

// 4c: monthly interest rate from annual rate -- 3
const am4c = [7.2, 6.6, 8.4];
for (const rate of am4c) {
  const monthly = rate / 12;
  push({
    topic: TOPIC,
    question: `A mortgage carries a fixed annual interest rate of ${pct(rate)}. What is the equivalent simple monthly interest rate applied to the outstanding balance?`,
    choice_a: pct(monthly),
    choice_b: pct(rate),
    choice_c: pct(rate / 6),
    choice_d: pct(monthly * 3),
    correct_choice: 'A',
    explanation: `Monthly rate = Annual rate / 12 = ${pct(rate)} / 12 = ${pct(monthly)}.`,
    weight: 2,
    source_note: 'hedge: standard real estate finance math (annual-to-monthly rate conversion)'
  });
}

// 4d: new loan balance after a stated principal payment amount -- 4
const am4d = [
  [260000, 410], [310000, 480], [180000, 290], [440000, 690]
];
for (const [bal, principalPaid] of am4d) {
  const newBal = bal - principalPaid;
  push({
    topic: TOPIC,
    question: `A borrower's outstanding mortgage balance is ${money(bal)}. Of the borrower's next monthly payment, ${money(principalPaid)} is applied to principal. What is the new outstanding loan balance after that payment?`,
    choice_a: money(newBal),
    choice_b: money(bal),
    choice_c: money(bal + principalPaid),
    choice_d: money(bal - principalPaid * 2),
    correct_choice: 'A',
    explanation: `New balance = Prior balance - principal portion of payment = ${money(bal)} - ${money(principalPaid)} = ${money(newBal)}.`,
    weight: 2,
    source_note: 'hedge: standard real estate finance math (declining-balance amortization concept, applied)'
  });
}

// =========================================================================
// CATEGORY 5: New York mortgage recording tax -- $ calculations -- 16 questions
// =========================================================================

// 5a: NYC residential (1-3 family / individual condo unit), loan < $500,000 -> 1.8%
const mrt5a = [240000, 320000, 380000, 420000, 460000];
for (const loan of mrt5a) {
  const tax = loan * 0.018;
  push({
    topic: TOPIC,
    question: `A buyer in New York City closes on a ${money(loan)} purchase-money mortgage for a one-family residence (loan under $500,000, individual residential rate). Using an NYC mortgage recording tax rate of 1.8%, what is the mortgage recording tax due?`,
    choice_a: money(tax),
    choice_b: money(loan * 0.01925),
    choice_c: money(loan * 0.01),
    choice_d: money(loan * 0.025),
    correct_choice: 'A',
    explanation: `Mortgage recording tax = Loan amount x rate = ${money(loan)} x 1.8% = ${money(tax)}.`,
    weight: 4,
    source_note: 'hedge: well-corroborated NY real estate closing-cost industry sources (NYC mortgage recording tax rate tiers)'
  });
}

// 5b: NYC residential, loan >= $500,000 -> 1.925%
const mrt5b = [520000, 600000, 760000, 900000, 1200000];
for (const loan of mrt5b) {
  const tax = loan * 0.01925;
  push({
    topic: TOPIC,
    question: `A buyer in New York City closes on a ${money(loan)} purchase-money mortgage for a one-family residence (loan at or above $500,000, individual residential rate). Using an NYC mortgage recording tax rate of 1.925%, what is the mortgage recording tax due?`,
    choice_a: money(tax),
    choice_b: money(loan * 0.018),
    choice_c: money(loan * 0.01),
    choice_d: money(loan * 0.025),
    correct_choice: 'A',
    explanation: `Mortgage recording tax = Loan amount x rate = ${money(loan)} x 1.925% = ${money(tax)}.`,
    weight: 4,
    source_note: 'hedge: well-corroborated NY real estate closing-cost industry sources (NYC mortgage recording tax rate tiers)'
  });
}

// 5c: outside NYC, combined 1.00% (basic 0.50% + special additional 0.25% + additional 0.25%),
//     with the special additional tax (0.25%) customarily paid by the lender on 1-6 family dwellings
const mrt5c = [160000, 240000, 280000, 400000];
for (const loan of mrt5c) {
  const total = loan * 0.01;
  const lenderShare = loan * 0.0025;
  const borrowerShare = loan * 0.0075;
  push({
    topic: TOPIC,
    question: `A property outside New York City is financed with a ${money(loan)} mortgage, where the combined mortgage recording tax rate (basic tax + special additional tax + additional tax) is 1.00% of the loan. On this 1-6 family dwelling, the lender customarily pays the 0.25% special additional tax. How much of the total tax is the borrower responsible for paying?`,
    choice_a: money(borrowerShare),
    choice_b: money(total),
    choice_c: money(lenderShare),
    choice_d: money(loan * 0.005),
    correct_choice: 'A',
    explanation: `Total tax = ${money(loan)} x 1.00% = ${money(total)}. Lender's customary share (special additional tax) = ${money(loan)} x 0.25% = ${money(lenderShare)}. Borrower's share = ${money(total)} - ${money(lenderShare)} = ${money(loan)} x 0.75% = ${money(borrowerShare)}.`,
    weight: 4,
    source_note: 'hedge: well-corroborated NY mortgage recording tax industry sources (basic 0.50% / special additional 0.25% / additional 0.25% components; lender-paid special additional tax on 1-6 family dwellings)'
  });
}

// 5d: reverse -- given tax paid (NYC, <$500k, 1.8%), find the loan amount
const mrt5d = [4500, 8100];
for (const tax of mrt5d) {
  const loan = tax / 0.018;
  push({
    topic: TOPIC,
    question: `A buyer in New York City paid ${money(tax)} in mortgage recording tax at closing on a one-family residence, at the 1.8% rate applicable to loans under $500,000. What was the loan amount?`,
    choice_a: money(loan),
    choice_b: money(tax / 0.01925),
    choice_c: money(tax / 0.01),
    choice_d: money(tax * 0.018),
    correct_choice: 'A',
    explanation: `Loan amount = Tax paid / rate = ${money(tax)} / 1.8% = ${money(loan)}.`,
    weight: 3,
    source_note: 'hedge: well-corroborated NY real estate closing-cost industry sources (NYC mortgage recording tax rate tiers)'
  });
}

// =========================================================================
// CATEGORY 6: NYS real estate transfer tax ($2 per $500, i.e. 0.4%) -- 10 questions
// =========================================================================

// 6a: price -> tax
const tt6a = [250000, 375000, 450000, 600000, 825000, 1125000];
for (const price of tt6a) {
  const tax = price * 0.004;
  push({
    topic: TOPIC,
    question: `A property sells for ${money(price)}. Using the New York State real estate transfer tax rate of $2 per $500 of consideration (0.4%), what transfer tax is due?`,
    choice_a: money(tax),
    choice_b: money(price * 0.01),
    choice_c: money(price * 0.002),
    choice_d: money(price * 0.0075),
    correct_choice: 'A',
    explanation: `NYS transfer tax = Sale price x 0.4% = ${money(price)} x 0.004 = ${money(tax)}.`,
    weight: 3,
    source_note: 'New York Tax Law Article 31 (real estate transfer tax, $2 per $500 of consideration)'
  });
}

// 6b: tax -> price
const tt6b = [2000, 3600];
for (const tax of tt6b) {
  const price = tax / 0.004;
  push({
    topic: TOPIC,
    question: `A seller paid ${money(tax)} in New York State real estate transfer tax on a sale, at the standard $2-per-$500 (0.4%) rate. What was the sale price?`,
    choice_a: money(price),
    choice_b: money(tax / 0.01),
    choice_c: money(tax / 0.002),
    choice_d: money(tax * 0.004),
    correct_choice: 'A',
    explanation: `Sale price = Transfer tax / rate = ${money(tax)} / 0.4% = ${money(price)}.`,
    weight: 3,
    source_note: 'New York Tax Law Article 31 (real estate transfer tax, $2 per $500 of consideration)'
  });
}

// 6c: combined NYS transfer tax + NYC RPTT (seller-side closing costs)
const tt6c = [
  { price: 450000, rpttRate: 0.01, label: 'at or below $500,000' },
  { price: 680000, rpttRate: 0.01425, label: 'above $500,000' }
];
for (const { price, rpttRate, label } of tt6c) {
  const nys = price * 0.004;
  const rptt = price * rpttRate;
  const total = nys + rptt;
  push({
    topic: TOPIC,
    question: `A residential property in New York City sells for ${money(price)} (${label} residential tier). The seller owes both the NYS transfer tax (0.4%) and the NYC Real Property Transfer Tax (RPTT, ${pct(rpttRate * 100)} at this price tier). What is the seller's combined transfer-tax obligation?`,
    choice_a: money(total),
    choice_b: money(nys),
    choice_c: money(rptt),
    choice_d: money(price * 0.02),
    correct_choice: 'A',
    explanation: `NYS transfer tax = ${money(price)} x 0.4% = ${money(nys)}. NYC RPTT = ${money(price)} x ${pct(rpttRate * 100)} = ${money(rptt)}. Combined seller-paid transfer tax = ${money(nys)} + ${money(rptt)} = ${money(total)}.`,
    weight: 4,
    source_note: 'New York Tax Law Article 31 (NYS transfer tax); NYC Administrative Code (Real Property Transfer Tax, RPTT rate tiers)'
  });
}

// =========================================================================
// CATEGORY 7: NYC mansion tax (Tax Law 1402-a, flat rate on full price by bracket) -- 10 questions
// =========================================================================

const mansion7a = [
  [1500000, 1.0], [2500000, 1.25], [4000000, 1.5], [7500000, 2.25],
  [12000000, 3.25], [17500000, 3.5], [22500000, 3.75], [30000000, 3.9]
];
for (const [price, rate] of mansion7a) {
  const tax = price * (rate / 100);
  push({
    topic: TOPIC,
    question: `A residential property in New York City sells for ${money(price)}. Under the NYC/NYS "mansion tax" bracket schedule (Tax Law Section 1402-a), what is the mansion tax owed?`,
    choice_a: money(tax),
    choice_b: money(tax / 2),
    choice_c: money((price - 1000000) * (rate / 100)),
    choice_d: money(price * ((rate + 1) / 100)),
    correct_choice: 'A',
    explanation: `At a purchase price of ${money(price)}, the applicable mansion tax bracket rate is ${pct(rate)}, applied to the entire purchase price (not just the amount above the bracket threshold): ${money(price)} x ${pct(rate)} = ${money(tax)}.`,
    weight: 4,
    source_note: 'New York Tax Law Section 1402-a (NYC "mansion tax" progressive bracket schedule, effective July 1, 2019)'
  });
}

push({
  topic: TOPIC,
  question: `A residential property in New York City sells for $999,999. A nearly identical unit down the hall sells for $1,000,000. Why is there a dramatic jump in the buyer's NYC mansion tax between these two sales, rather than a gradual increase?`,
  choice_a: 'Because the mansion tax is a flat rate applied to the entire purchase price once a bracket threshold is crossed, not a marginal tax on only the amount above the threshold -- crossing $1,000,000 triggers a 1% tax on the full price ($10,000), while $999,999 triggers no mansion tax at all',
  choice_b: 'Because properties above $1,000,000 are taxed at a lower rate as an incentive for luxury sales',
  choice_c: 'Because the mansion tax only applies to commercial property, not residential property, above $1,000,000',
  choice_d: 'Because the extra dollar itself is taxed at 3.9%, with the rest of the price taxed at 0%',
  correct_choice: 'A',
  explanation: `Unlike a marginal income-tax bracket, the NYC mansion tax applies its bracket rate to the entire purchase price once the threshold is met, creating a "cliff effect": $999,999 owes $0 in mansion tax, while $1,000,000 owes 1% of the full price, or $10,000.`,
  weight: 4,
  source_note: 'New York Tax Law Section 1402-a (NYC "mansion tax" -- flat, non-marginal bracket application, "cliff effect")'
});

push({
  topic: TOPIC,
  question: `A buyer purchases a $3,000,000 condo in New York City with a $2,400,000 mortgage. What is the buyer's combined cost for (1) the NYC mortgage recording tax on the loan (1.925%, loan at/above $500,000) and (2) the NYC mansion tax on the purchase price (1.5% bracket, $3,000,000-$4,999,999)?`,
  choice_a: money(2400000 * 0.01925 + 3000000 * 0.015),
  choice_b: money(3000000 * 0.01925 + 2400000 * 0.015),
  choice_c: money(2400000 * 0.01925),
  choice_d: money(3000000 * 0.015),
  correct_choice: 'A',
  explanation: `Mortgage recording tax = ${money(2400000)} x 1.925% = ${money(2400000 * 0.01925)}. Mansion tax = ${money(3000000)} x 1.5% = ${money(3000000 * 0.015)}. Combined buyer cost = ${money(2400000 * 0.01925)} + ${money(3000000 * 0.015)} = ${money(2400000 * 0.01925 + 3000000 * 0.015)}.`,
  weight: 4,
  source_note: 'hedge: well-corroborated NY closing-cost industry sources (NYC mortgage recording tax); New York Tax Law Section 1402-a (NYC mansion tax bracket schedule)'
});

// =========================================================================
// CATEGORY 8: CEMA math (new-money tax base vs. full loan tax base) -- 12 questions
// =========================================================================

// 8a: new money, tax with CEMA, tax without CEMA, tax saved -- 8
const cema8a = [
  { B: 180000, L: 310000, rate: 0.018, label: 'NYC, under $500,000' },
  { B: 250000, L: 420000, rate: 0.018, label: 'NYC, under $500,000' },
  { B: 95000, L: 275000, rate: 0.018, label: 'NYC, under $500,000' },
  { B: 520000, L: 800000, rate: 0.01925, label: 'NYC, at/above $500,000' },
  { B: 600000, L: 1000000, rate: 0.01925, label: 'NYC, at/above $500,000' },
  { B: 140000, L: 225000, rate: 0.01, label: 'outside NYC, combined 1.00%' },
  { B: 210000, L: 350000, rate: 0.01, label: 'outside NYC, combined 1.00%' },
  { B: 75000, L: 160000, rate: 0.01, label: 'outside NYC, combined 1.00%' }
];
for (const { B, L, rate, label } of cema8a) {
  const newMoney = L - B;
  const taxWithCema = newMoney * rate;
  const taxWithoutCema = L * rate;
  const saved = B * rate;
  push({
    topic: TOPIC,
    question: `A borrower refinances, consolidating an existing unpaid mortgage balance of ${money(B)} with a new loan of ${money(L)} via a CEMA (${label}, mortgage recording tax rate ${pct(rate * 100)}). How much mortgage recording tax is saved by using the CEMA instead of recording the full new loan amount?`,
    choice_a: money(saved),
    choice_b: money(taxWithCema),
    choice_c: money(taxWithoutCema),
    choice_d: money(newMoney * rate * 0.5),
    correct_choice: 'A',
    explanation: `Without a CEMA, tax would apply to the full new loan: ${money(L)} x ${pct(rate * 100)} = ${money(taxWithoutCema)}. With the CEMA, tax applies only to the "new money" above the consolidated balance: (${money(L)} - ${money(B)}) x ${pct(rate * 100)} = ${money(newMoney)} x ${pct(rate * 100)} = ${money(taxWithCema)}. Tax saved = ${money(taxWithoutCema)} - ${money(taxWithCema)} = ${money(B)} x ${pct(rate * 100)} = ${money(saved)}.`,
    weight: 4,
    source_note: 'New York Tax Law Section 255 (CEMA tax treatment: mortgage recording tax applies only to new money above the consolidated unpaid balance)'
  });
}

// 8b: reverse -- given tax saved and rate, find the old consolidated balance
const cema8b = [
  { saved: 9000, rate: 0.018 },
  { saved: 5775, rate: 0.01925 }
];
for (const { saved, rate } of cema8b) {
  const B = saved / rate;
  push({
    topic: TOPIC,
    question: `By using a CEMA on a refinance, a borrower saved ${money(saved)} in mortgage recording tax, at a ${pct(rate * 100)} tax rate. What was the unpaid principal balance being consolidated into the new loan?`,
    choice_a: money(B),
    choice_b: money(saved * rate),
    choice_c: money(B / 2),
    choice_d: money(B * 2),
    correct_choice: 'A',
    explanation: `Tax saved = consolidated balance x rate, so consolidated balance = Tax saved / rate = ${money(saved)} / ${pct(rate * 100)} = ${money(B)}.`,
    weight: 3,
    source_note: 'New York Tax Law Section 255 (CEMA tax treatment)'
  });
}

// 8c: percentage of otherwise-due tax avoided via CEMA (= B/L, independent of the rate)
const cema8c = [
  { B: 300000, L: 500000 },
  { B: 225000, L: 900000 }
];
for (const { B, L } of cema8c) {
  const pctAvoided = B / L * 100;
  push({
    topic: TOPIC,
    question: `A borrower consolidates an existing unpaid balance of ${money(B)} into a new ${money(L)} loan via a CEMA. What percentage of the mortgage recording tax that would otherwise be due on the full new loan is avoided by using the CEMA?`,
    choice_a: pct(pctAvoided),
    choice_b: pct(L / B),
    choice_c: pct((L - B) / L * 100),
    choice_d: pct(pctAvoided / 2),
    correct_choice: 'A',
    explanation: `Because CEMA tax savings equal (old balance x rate), while the full tax equals (new loan x rate), the percentage of tax avoided is old balance / new loan, regardless of the specific rate: ${money(B)} / ${money(L)} = ${pct(pctAvoided)}.`,
    weight: 3,
    source_note: 'New York Tax Law Section 255 (CEMA tax treatment)'
  });
}

// =========================================================================
// CATEGORY 9: New doctrine -- loan types, ARM mechanics, TRID/RESPA, PMI, NY foreclosure detail, alternatives -- 35 questions
// =========================================================================

const doctrine = [
  {
    question: "An FHA loan is best described as:",
    choice_a: "A loan made by a private lender that is insured by the Federal Housing Administration, protecting the lender against borrower default and allowing more flexible down payment and credit requirements",
    choice_b: "A loan made directly by the federal government to the borrower, with the FHA acting as the lender of record",
    choice_c: "A loan available only to first-time buyers purchasing property in New York City",
    choice_d: "A loan that eliminates the need for any property appraisal",
    correct_choice: "A",
    explanation: "FHA loans are originated by private, FHA-approved lenders and insured by the Federal Housing Administration (part of HUD), which reimburses the lender for losses on default -- this government insurance is what allows FHA loans to offer more flexible qualifying standards than many conventional loans.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (FHA loan structure)"
  },
  {
    question: "What is the minimum down payment commonly associated with an FHA loan for a qualifying borrower?",
    choice_a: "3.5% of the purchase price",
    choice_b: "20% of the purchase price",
    choice_c: "0%, FHA loans never require a down payment",
    choice_d: "50% of the purchase price",
    correct_choice: "A",
    explanation: "FHA loans commonly allow a minimum down payment as low as 3.5% of the purchase price for borrowers who meet FHA credit-score requirements, one of the program's key attractions for buyers with limited cash reserves.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (FHA minimum down payment)"
  },
  {
    question: "FHA loans require borrowers to pay mortgage insurance premiums (MIP). Which of the following describes this requirement?",
    choice_a: "Both an upfront MIP paid (or financed) at closing and an ongoing annual MIP included in the monthly payment",
    choice_b: "Only a one-time MIP paid at closing, with no ongoing monthly cost ever",
    choice_c: "MIP applies only to FHA loans on investment properties, never owner-occupied homes",
    choice_d: "MIP is optional and borrowers may decline it at closing",
    correct_choice: "A",
    explanation: "FHA-insured loans generally require both an upfront mortgage insurance premium (often financed into the loan) and an ongoing annual MIP collected as part of the monthly payment -- unlike conventional PMI, FHA's annual MIP does not always automatically cancel simply because equity reaches a given threshold.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (FHA MIP structure)"
  },
  {
    question: "A VA loan is a mortgage benefit available to which category of borrowers?",
    choice_a: "Eligible active-duty service members, veterans, and certain surviving spouses, who obtain a Certificate of Eligibility (COE) to use the benefit",
    choice_b: "Any first-time homebuyer regardless of military service",
    choice_c: "Only borrowers purchasing commercial property",
    choice_d: "Only borrowers with a down payment of at least 20%",
    correct_choice: "A",
    explanation: "VA loans are a benefit of the U.S. Department of Veterans Affairs' home loan guaranty program, available to eligible active-duty service members, veterans, and certain surviving spouses who obtain a Certificate of Eligibility documenting their entitlement.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (VA loan eligibility)"
  },
  {
    question: "One of the most well-known advantages of a VA-guaranteed loan, compared to most conventional financing, is:",
    choice_a: "Eligible borrowers can often finance 100% of the purchase price, with no down payment required",
    choice_b: "VA loans always have a higher interest rate than conventional loans",
    choice_c: "VA loans require a minimum 20% down payment, higher than conventional loans",
    choice_d: "VA loans are available only for the purchase of vacant land",
    correct_choice: "A",
    explanation: "A signature feature of the VA loan guaranty program is that eligible borrowers can often finance up to 100% of the purchase price with no down payment, since the VA's guaranty to the lender substitutes for the borrower equity conventional or FHA lenders typically require.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (VA loan no-down-payment feature)"
  },
  {
    question: "Unlike FHA and most conventional loans with less than 20% down, a VA-guaranteed loan generally does NOT require the borrower to pay:",
    choice_a: "Ongoing monthly private mortgage insurance or FHA-style annual mortgage insurance premiums",
    choice_b: "Any closing costs whatsoever, on any loan",
    choice_c: "Property taxes for the life of the loan",
    choice_d: "Homeowners insurance premiums",
    correct_choice: "A",
    explanation: "VA-guaranteed loans do not require monthly mortgage insurance (unlike conventional PMI or FHA's annual MIP); instead, VA loans typically involve a one-time VA funding fee, which can often be financed into the loan and may be waived for veterans with a service-connected disability.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (VA loans and mortgage insurance)"
  },
  {
    question: "How does a 'conventional' mortgage loan generally differ from an FHA or VA loan?",
    choice_a: "A conventional loan is not insured or guaranteed by a government agency, and typically relies on conforming underwriting guidelines (such as those of Fannie Mae or Freddie Mac) rather than government insurance",
    choice_b: "A conventional loan is always guaranteed by the Department of Veterans Affairs",
    choice_c: "A conventional loan is only available to borrowers with no credit history",
    choice_d: "A conventional loan can never be used to purchase a single-family home",
    correct_choice: "A",
    explanation: "Conventional loans are originated without direct government insurance or guaranty; many are underwritten to 'conforming' standards set by Fannie Mae and Freddie Mac (which purchase and securitize such loans), while loans exceeding conforming loan limits are called 'jumbo' loans.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (conventional loan structure)"
  },
  {
    question: "A 'jumbo' mortgage loan is a loan that:",
    choice_a: "Exceeds the conforming loan limits set for loans eligible for purchase by Fannie Mae and Freddie Mac, often requiring stricter underwriting and sometimes a higher interest rate",
    choice_b: "Is guaranteed entirely by the FHA regardless of size",
    choice_c: "Refers to any loan under $50,000",
    choice_d: "Is a type of adjustable-rate loan exclusive to commercial property",
    correct_choice: "A",
    explanation: "A jumbo loan exceeds the conforming loan limits established for loans that Fannie Mae and Freddie Mac may purchase; because jumbo loans are not eligible for sale to those government-sponsored enterprises, lenders often apply stricter underwriting standards and sometimes different pricing.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (jumbo/conforming loan distinction)"
  },
  {
    question: "Private mortgage insurance (PMI) is typically required by a conventional lender when:",
    choice_a: "The borrower's loan-to-value ratio exceeds 80% (i.e., the down payment is less than 20%)",
    choice_b: "The borrower's credit score is above 800",
    choice_c: "The loan is a VA-guaranteed loan",
    choice_d: "The property is being purchased entirely with cash",
    correct_choice: "A",
    explanation: "Conventional lenders typically require PMI when the loan-to-value ratio exceeds 80%, protecting the lender against loss on the portion of risk above what a 20%-down borrower's equity cushion would normally cover.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (PMI requirement threshold)"
  },
  {
    question: "Under the federal Homeowners Protection Act, when must a lender automatically terminate PMI on a residential mortgage (assuming the loan is current)?",
    choice_a: "When the loan balance is first scheduled to reach 78% of the original value of the property",
    choice_b: "PMI must be maintained for the full life of the loan and can never be terminated",
    choice_c: "Automatically after exactly 5 years, regardless of the loan-to-value ratio",
    choice_d: "Only if the borrower pays off the loan in full",
    correct_choice: "A",
    explanation: "The federal Homeowners Protection Act of 1998 requires lenders to automatically terminate PMI once the loan balance is first scheduled to reach 78% of the property's original value (assuming the borrower is current on payments), separate from the borrower's own right to request cancellation at 80% LTV.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal consumer-finance curriculum content (Homeowners Protection Act, automatic PMI termination)"
  },
  {
    question: "Under the Homeowners Protection Act, at what loan-to-value ratio may a borrower affirmatively request PMI cancellation (assuming the loan is current and other conditions are met)?",
    choice_a: "80% LTV",
    choice_b: "50% LTV",
    choice_c: "95% LTV",
    choice_d: "PMI cancellation can never be requested by the borrower, only initiated by the lender",
    correct_choice: "A",
    explanation: "The Homeowners Protection Act allows a borrower to request PMI cancellation once the loan balance reaches 80% of the home's original value, generally in writing, subject to the borrower's payment history and any lender documentation requirements.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal consumer-finance curriculum content (Homeowners Protection Act, borrower-requested PMI cancellation)"
  },
  {
    question: "In an adjustable-rate mortgage (ARM), the interest rate the borrower pays after the initial period is generally calculated as:",
    choice_a: "A published index rate plus a lender's margin, together forming the 'fully indexed rate,' subject to any applicable rate caps",
    choice_b: "A rate set entirely at the lender's discretion with no reference to any index",
    choice_c: "Always the same fixed rate disclosed at origination, for the full loan term",
    choice_d: "The borrower's credit score divided by the loan term",
    correct_choice: "A",
    explanation: "An ARM's rate after any initial fixed period is generally the sum of a published index (such as an index tied to Treasury yields or SOFR) plus the lender's margin, producing the 'fully indexed rate,' which is then subject to whatever periodic and lifetime caps the loan documents specify.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (ARM index + margin structure)"
  },
  {
    question: "In ARM terminology, what does a loan's 'cap structure' (e.g., initial, periodic, and lifetime caps) generally limit?",
    choice_a: "How much the interest rate can increase (or decrease) at the first adjustment, at each subsequent adjustment, and over the full life of the loan",
    choice_b: "The maximum number of borrowers who may be listed on the loan",
    choice_c: "The maximum size of the down payment a borrower may make",
    choice_d: "The number of properties a single borrower may finance",
    correct_choice: "A",
    explanation: "ARM rate caps typically come in three parts: an initial adjustment cap (limiting the first rate change), a periodic adjustment cap (limiting each later change), and a lifetime cap (limiting the total increase over the life of the loan) -- all designed to bound the borrower's payment-shock risk.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (ARM rate caps)"
  },
  {
    question: "In a '5/1 ARM,' what do the numbers '5' and '1' generally refer to?",
    choice_a: "The rate is fixed for the first 5 years, then adjusts once per year (every 1 year) thereafter",
    choice_b: "The borrower makes 5 payments per year for 1 year only",
    choice_c: "The maximum loan term is 5 years and 1 month",
    choice_d: "The down payment is 5% and the loan-to-value ratio is 1%",
    correct_choice: "A",
    explanation: "In common ARM naming convention, the first number indicates the length (in years) of the initial fixed-rate period, and the second number indicates how often (in years) the rate adjusts afterward -- so a 5/1 ARM has a 5-year fixed period followed by annual adjustments.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal mortgage-finance curriculum content (ARM naming convention)"
  },
  {
    question: "The TILA-RESPA Integrated Disclosure rule (TRID) combined which two federal disclosure regimes into the Loan Estimate and Closing Disclosure forms?",
    choice_a: "The Truth in Lending Act (TILA) and the Real Estate Settlement Procedures Act (RESPA)",
    choice_b: "The Fair Housing Act and the Equal Credit Opportunity Act",
    choice_c: "New York's RPAPL and Tax Law",
    choice_d: "The Fair Credit Reporting Act and the Dodd-Frank Act, exclusively",
    correct_choice: "A",
    explanation: "TRID integrated the mortgage-related disclosures previously required separately under TILA and RESPA into two combined forms: the Loan Estimate (provided early in the process) and the Closing Disclosure (provided before closing).",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal consumer-finance curriculum content (TRID rule)"
  },
  {
    question: "Under TRID, generally how soon after a borrower applies for a mortgage must the lender provide the Loan Estimate?",
    choice_a: "Within 3 business days of receiving the loan application",
    choice_b: "Within 60 days of closing",
    choice_c: "There is no timing requirement under TRID",
    choice_d: "Only after the loan has already closed",
    correct_choice: "A",
    explanation: "Under TRID, a lender must generally provide the borrower with the Loan Estimate within 3 business days after receiving a completed loan application, giving the borrower an early, standardized view of the loan's projected terms and closing costs.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal consumer-finance curriculum content (TRID Loan Estimate timing)"
  },
  {
    question: "Under TRID, generally how far in advance of closing must the borrower receive the Closing Disclosure?",
    choice_a: "At least 3 business days before closing (consummation of the loan)",
    choice_b: "At least 30 business days before closing",
    choice_c: "The Closing Disclosure may be provided at the closing table itself with no advance notice",
    choice_d: "Only after closing has already occurred, as a receipt",
    correct_choice: "A",
    explanation: "TRID requires that the borrower receive the Closing Disclosure at least 3 business days before the loan closes, giving the borrower time to review final terms and costs; certain later changes (such as an APR change) can trigger a new 3-business-day waiting period.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal consumer-finance curriculum content (TRID Closing Disclosure timing)"
  },
  {
    question: "RESPA's Section 8 anti-kickback provision generally prohibits:",
    choice_a: "Giving or accepting fees, kickbacks, or things of value in exchange for the referral of settlement-service business (such as mortgage, title, or escrow referrals)",
    choice_b: "Lenders from ever charging an origination fee",
    choice_c: "Borrowers from shopping for their own title insurance company",
    choice_d: "Real estate brokers from ever recommending any lender to a client",
    correct_choice: "A",
    explanation: "RESPA Section 8 prohibits giving or receiving any fee, kickback, or thing of value in exchange for referrals of real estate settlement service business, aimed at preventing referral arrangements that inflate costs to consumers without added value.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal consumer-finance curriculum content (RESPA Section 8 anti-kickback provision)"
  },
  {
    question: "TILA's right of rescission generally gives a borrower how many business days to cancel certain refinance transactions secured by the borrower's primary residence?",
    choice_a: "3 business days after the transaction (or after receiving required disclosures, if later)",
    choice_b: "30 business days",
    choice_c: "There is no right of rescission under TILA for any transaction",
    choice_d: "1 year",
    correct_choice: "A",
    explanation: "TILA generally gives borrowers a 3-business-day right to rescind certain refinance and home-equity transactions secured by their primary residence (this right of rescission does not apply to a purchase-money mortgage).",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal consumer-finance curriculum content (TILA right of rescission)"
  },
  {
    question: "What is the primary purpose of a lender-maintained mortgage escrow (or 'impound') account?",
    choice_a: "To collect a portion of the borrower's monthly payment to cover recurring obligations like property taxes and homeowners insurance, which the servicer then pays on the borrower's behalf when due",
    choice_b: "To hold the buyer's earnest money deposit during contract negotiations",
    choice_c: "To pay the real estate broker's commission at closing",
    choice_d: "To hold funds that the borrower may withdraw at will for any purpose",
    correct_choice: "A",
    explanation: "A mortgage escrow (impound) account collects a monthly portion of anticipated property tax and homeowners insurance costs along with the borrower's principal-and-interest payment, so the loan servicer can pay those bills on time when they come due, reducing the risk of a tax lien or lapsed insurance coverage.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance curriculum content (mortgage escrow/impound accounts)"
  },
  {
    question: "A 'due-on-sale' clause in a mortgage or deed of trust generally allows the lender to:",
    choice_a: "Declare the full remaining loan balance immediately due and payable if the property is sold or transferred without the lender's consent",
    choice_b: "Automatically reduce the interest rate whenever the property is sold",
    choice_c: "Prevent the borrower from ever selling the property, permanently",
    choice_d: "Require the buyer to pay off the loan only if the sale price is below the appraised value",
    correct_choice: "A",
    explanation: "A due-on-sale clause lets the lender accelerate the loan -- demanding immediate repayment of the full balance -- if the property is sold or otherwise transferred without the lender's consent, which is why most conventional loans cannot simply be taken over informally by a buyer.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance curriculum content (due-on-sale clause)"
  },
  {
    question: "Compared to most conventional loans, FHA and VA loans are generally considered:",
    choice_a: "More readily assumable by a qualified subsequent buyer, since they typically lack a strict due-on-sale clause blocking assumption",
    choice_b: "Never assumable under any circumstances",
    choice_c: "Automatically transferred to a buyer with no qualification process whatsoever",
    choice_d: "Only assumable by immediate family members of the original borrower",
    correct_choice: "A",
    explanation: "FHA and VA loans are generally more assumable than most conventional loans (which typically include a due-on-sale clause), though the assuming buyer usually still must meet the lender/agency's qualification requirements -- this can be valuable when the existing loan carries a below-market interest rate.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance curriculum content (assumable FHA/VA loans)"
  },
  {
    question: "A 'balloon mortgage' is a loan structured so that:",
    choice_a: "Regular payments are calculated on a longer amortization schedule, but the entire remaining balance becomes due in a single large lump-sum payment before the loan is fully amortized",
    choice_b: "The interest rate doubles every year automatically",
    choice_c: "No payments of any kind are required until the loan is fully due",
    choice_d: "The loan amount increases every month",
    correct_choice: "A",
    explanation: "A balloon mortgage sets regular payments as if amortizing over a longer period (e.g., 30 years), but requires the full remaining balance to be paid off in one lump sum at a much earlier date (e.g., after 5 or 7 years) -- borrowers often plan to refinance or sell before the balloon payment comes due.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance curriculum content (balloon mortgage structure)"
  },
  {
    question: "A 'purchase money mortgage' most commonly refers to:",
    choice_a: "Seller financing, where the seller extends credit to the buyer (rather than, or in addition to, a bank loan) and takes back a mortgage or note as security",
    choice_b: "A government grant that pays a portion of the buyer's down payment",
    choice_c: "A loan that can only be used to purchase raw land, never an existing home",
    choice_d: "The buyer's earnest money deposit",
    correct_choice: "A",
    explanation: "A purchase money mortgage is most commonly seller-provided financing in a real estate transaction, where the seller (rather than or alongside a conventional lender) extends credit to the buyer, secured by a mortgage or note on the property being sold.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance curriculum content (purchase money mortgage / seller financing)"
  },
  {
    question: "A 'wraparound mortgage' is a financing arrangement in which:",
    choice_a: "A new loan is made for an amount that includes (wraps around) an existing underlying mortgage that remains in place, with the new lender collecting the borrower's full payment and remitting the underlying loan's payment from it",
    choice_b: "Two unrelated properties are financed with a single loan",
    choice_c: "The borrower's homeowners insurance policy is bundled into the loan payment automatically",
    choice_d: "A loan is guaranteed jointly by the FHA and the VA at the same time",
    correct_choice: "A",
    explanation: "In a wraparound mortgage, a new loan (often seller-financed) is made in an amount that includes the balance of an existing underlying mortgage which remains in place; the borrower pays the wraparound lender, who in turn keeps making payments on the underlying loan out of what is collected.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance curriculum content (wraparound mortgage)"
  },
  {
    question: "How does a second mortgage (or home equity line of credit, HELOC) generally rank compared to a first mortgage in a foreclosure sale?",
    choice_a: "It is a subordinate (junior) lien, generally paid from sale proceeds only after the first mortgage is satisfied in full",
    choice_b: "It is always paid before the first mortgage",
    choice_c: "It has no effect whatsoever on lien priority",
    choice_d: "It automatically converts into ownership of the property",
    correct_choice: "A",
    explanation: "A second mortgage or HELOC is typically a subordinate (junior) lien behind the first mortgage; in a foreclosure sale, proceeds generally satisfy the senior (first) lien before any remaining funds reach junior lienholders, which is part of why second-lien financing is riskier for the lender and often priced accordingly.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance curriculum content (subordinate lien priority)"
  },
  {
    question: "In New York's judicial foreclosure process, what is a defaulted borrower's 'equity of redemption'?",
    choice_a: "The borrower's right, up until the foreclosure sale actually occurs, to pay off the full outstanding debt (plus costs) and stop the foreclosure, keeping the property",
    choice_b: "A tax credit the borrower receives after losing the property",
    choice_c: "The right to remain in the property indefinitely for free, even after a sale to a third party",
    choice_d: "A right that exists only after the property has already been sold at auction",
    correct_choice: "A",
    explanation: "The equity of redemption is the defaulted borrower's right -- recognized up until the foreclosure sale is actually completed -- to pay off the full debt, interest, and costs and thereby redeem the property, stopping the foreclosure before title changes hands.",
    weight: 4,
    source_note: "hedge: well-corroborated NY judicial foreclosure practice (equity of redemption)"
  },
  {
    question: "In a New York judicial foreclosure action, who typically conducts the actual foreclosure sale once the court issues a judgment of foreclosure and sale?",
    choice_a: "A court-appointed referee, who conducts the public auction and reports the results back to the court",
    choice_b: "The borrower personally conducts the sale",
    choice_c: "The buyer's real estate broker conducts the sale independently of the court",
    choice_d: "No sale ever occurs; the lender automatically takes title without any auction",
    correct_choice: "A",
    explanation: "Following a judgment of foreclosure and sale in New York, the court appoints a referee to conduct the public foreclosure auction and report the results (including the sale price and distribution of proceeds) back to the court.",
    weight: 4,
    source_note: "hedge: well-corroborated NY judicial foreclosure practice (referee-conducted sale)"
  },
  {
    question: "After a New York judicial foreclosure sale, what document conveys title to the successful bidder at the auction?",
    choice_a: "A referee's deed",
    choice_b: "A quitclaim deed signed personally by the defaulted borrower",
    choice_c: "A warranty deed guaranteeing the property is free of all liens for 30 years",
    choice_d: "No deed is issued; title passes automatically upon the gavel falling",
    correct_choice: "A",
    explanation: "Title to the property is conveyed to the successful bidder at a New York foreclosure auction by a referee's deed, executed by the court-appointed referee who conducted the sale.",
    weight: 4,
    source_note: "hedge: well-corroborated NY judicial foreclosure practice (referee's deed)"
  },
  {
    question: "In a New York foreclosure, if the auction sale price exceeds the total amount owed to the foreclosing lender (plus costs and any senior liens), what happens to the excess funds?",
    choice_a: "They are addressed through 'surplus money proceedings,' generally distributed to junior lienholders in priority order and then to the former owner",
    choice_b: "They are automatically forfeited to New York State with no further process",
    choice_c: "They are kept entirely by the foreclosing lender as a bonus",
    choice_d: "They must be returned to the successful bidder who overpaid",
    correct_choice: "A",
    explanation: "When a New York foreclosure sale generates proceeds exceeding what is owed to the foreclosing party, the excess (surplus) is resolved through surplus money proceedings, which generally pay out to junior lienholders in order of priority and then to the former owner of the property.",
    weight: 4,
    source_note: "hedge: well-corroborated NY judicial foreclosure practice (surplus money proceedings)"
  },
  {
    question: "If a New York foreclosure sale does not generate enough proceeds to cover the full debt owed, RPAPL Section 1371 addresses the lender's ability to pursue what remedy against the borrower?",
    choice_a: "A deficiency judgment for the shortfall, subject to procedural requirements including a motion establishing the property's fair market value",
    choice_b: "Automatic criminal charges against the borrower",
    choice_c: "Immediate seizure of the borrower's other unrelated real property with no court process",
    choice_d: "No further remedy of any kind is ever available to the lender",
    correct_choice: "A",
    explanation: "RPAPL Section 1371 governs a lender's ability to seek a deficiency judgment against the borrower for any shortfall between the debt owed and the foreclosure sale proceeds, generally requiring the lender to make a motion (within a set time period) establishing the property's fair market value so any excessive 'credit bid' does not unfairly inflate the deficiency.",
    weight: 4,
    source_note: "RPAPL Section 1371 (deficiency judgment procedure following foreclosure sale)"
  },
  {
    question: "A 'deed in lieu of foreclosure' is an alternative to completing a foreclosure lawsuit in which:",
    choice_a: "The defaulted borrower voluntarily deeds the property directly to the lender, who accepts it in satisfaction of (or partial satisfaction of) the debt, avoiding a contested foreclosure action",
    choice_b: "The lender deeds the property to a random third party chosen by lottery",
    choice_c: "The borrower is required to purchase a second property before losing the first",
    choice_d: "The county automatically seizes the property for unpaid property taxes only",
    correct_choice: "A",
    explanation: "In a deed in lieu of foreclosure, the defaulted borrower voluntarily transfers the property's title directly to the lender, who accepts it in satisfaction (or partial satisfaction) of the mortgage debt -- generally faster and less costly than a full judicial foreclosure, though it requires the lender's agreement.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance/foreclosure-alternatives curriculum content (deed in lieu of foreclosure)"
  },
  {
    question: "A 'short sale' as an alternative to foreclosure generally involves:",
    choice_a: "The lender agreeing to allow the property to be sold to a third party for less than the total amount owed on the mortgage, releasing the lien upon closing under agreed terms",
    choice_b: "The seller receiving the full listing price with no lender involvement",
    choice_c: "A sale that must close within 24 hours of listing",
    choice_d: "A sale that automatically eliminates all of the seller's other debts",
    correct_choice: "A",
    explanation: "A short sale occurs when a distressed borrower's lender agrees to accept less than the full amount owed and allow the property to be sold to a third-party buyer, releasing its mortgage lien upon closing -- generally negotiated as a foreclosure alternative that can be less damaging to the borrower's credit and less costly for the lender than completing a foreclosure.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance/foreclosure-alternatives curriculum content (short sale)"
  },
  {
    question: "When a borrower pays off a mortgage in full, what document is the lender obligated to provide so the lien can be removed from the property's title record?",
    choice_a: "A satisfaction of mortgage (or certificate of discharge), which is recorded with the county clerk to clear the lien from title",
    choice_b: "A new deed transferring the property to a new owner",
    choice_c: "A lis pendens",
    choice_d: "Nothing; paid-off mortgage liens automatically disappear from the public record with no filing",
    correct_choice: "A",
    explanation: "When a mortgage is paid in full, the lender must provide a satisfaction of mortgage (sometimes called a certificate of discharge), which is recorded with the county clerk to formally clear the mortgage lien from the property's title record -- an important step for a clean title on any future sale or refinance.",
    weight: 4,
    source_note: "hedge: well-corroborated NY real estate closing/title practice (satisfaction of mortgage / certificate of discharge)"
  },
  {
    question: "Compared to non-judicial foreclosure states (where a lender can foreclose via a trustee's sale without going to court), how does New York's judicial foreclosure process generally compare in terms of time and complexity?",
    choice_a: "Generally longer and more procedurally involved, since it requires litigating a formal lawsuit through the court system rather than a simple out-of-court sale",
    choice_b: "Always faster, typically completed within one week",
    choice_c: "Identical in every respect, with no meaningful procedural differences",
    choice_d: "New York does not permit any foreclosures to be completed, regardless of time",
    correct_choice: "A",
    explanation: "Because New York requires a lender to file and litigate a court action (including notice periods, potential settlement conferences, a judgment of foreclosure and sale, referee sale, and possible surplus money or deficiency proceedings), the process is generally longer and more procedurally involved than in non-judicial (trustee's-sale) states.",
    weight: 4,
    source_note: "hedge: well-corroborated NY foreclosure practice (judicial foreclosure timeline/complexity compared to non-judicial states)"
  },
  {
    question: "Who is generally responsible for paying New York State's real estate transfer tax on the conveyance of real property, absent a contrary agreement or a grantor exemption?",
    choice_a: "The seller (grantor), since the tax is imposed on the person making the conveyance",
    choice_b: "The buyer (grantee), in every transaction without exception",
    choice_c: "The real estate broker who represents the seller",
    choice_d: "New York State itself absorbs the cost as a public subsidy",
    correct_choice: "A",
    explanation: "New York's real estate transfer tax is imposed on the grantor (seller); responsibility for payment generally falls to the seller, though if the seller fails to pay or is exempt from liability, the grantee (buyer) may become responsible.",
    weight: 3,
    source_note: "New York Tax Law Article 31 (real estate transfer tax, grantor liability for payment)"
  },
  {
    question: "Who is generally responsible for paying the NYC/NYS 'mansion tax' on a qualifying residential purchase, unlike the (seller-paid) NYS transfer tax?",
    choice_a: "The buyer (grantee)",
    choice_b: "The seller (grantor), exactly like the standard NYS transfer tax",
    choice_c: "The real estate broker who represents the buyer",
    choice_d: "The lender financing the transaction",
    correct_choice: "A",
    explanation: "Unlike the standard NYS real estate transfer tax (which is generally paid by the seller), the NYC/NYS mansion tax is paid by the buyer at closing on qualifying residential purchases of $1,000,000 or more.",
    weight: 4,
    source_note: "New York Tax Law Section 1402-a (NYC/NYS mansion tax, buyer-paid)"
  },
  {
    question: "The federal Real Estate Settlement Procedures Act (RESPA) generally applies to which category of loans?",
    choice_a: "Most federally related residential mortgage loans (loans secured by a lien on residential real property of one-to-four family), requiring disclosures and prohibiting certain referral-fee practices",
    choice_b: "Only commercial loans on office buildings",
    choice_c: "Only loans with no lender involvement whatsoever",
    choice_d: "Only loans made entirely in cash with no financing",
    correct_choice: "A",
    explanation: "RESPA generally applies to most federally related mortgage loans secured by residential (one-to-four family) property, requiring certain disclosures to borrowers and prohibiting kickbacks and unearned fees for referrals of settlement services.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated federal consumer-finance curriculum content (RESPA scope)"
  },
  {
    question: "A 'subordination agreement' between lienholders is used to:",
    choice_a: "Change the normal priority order of liens on a property, allowing a lien that would otherwise rank senior (or junior) to voluntarily agree to a different priority position relative to another lien",
    choice_b: "Automatically pay off all liens on a property simultaneously",
    choice_c: "Convert a mortgage into a lease",
    choice_d: "Eliminate the need for title insurance",
    correct_choice: "A",
    explanation: "A subordination agreement is a contract in which a lienholder agrees to accept a lower (subordinate) priority position relative to another lien than it would otherwise hold -- for example, when a homeowner refinances a first mortgage and an existing second mortgage/HELOC holder agrees to remain in second position behind the new first loan.",
    weight: 3,
    source_note: "hedge: standard, well-corroborated real estate finance curriculum content (subordination agreements and lien priority)"
  }
];
for (const d of doctrine) {
  push({
    topic: TOPIC,
    question: d.question,
    choice_a: d.choice_a,
    choice_b: d.choice_b,
    choice_c: d.choice_c,
    choice_d: d.choice_d,
    correct_choice: 'A',
    explanation: d.explanation,
    weight: d.weight,
    source_note: d.source_note
  });
}

// =========================================================================
// Write output
// =========================================================================
const outPath = __dirname + '/10_real_estate_finance_mortgages_extra.json';
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log('TOTAL:', out.length);
console.log('Doctrine count:', doctrine.length);
