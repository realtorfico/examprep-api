const fs = require('fs');

const cargoAdd = [
  {
    topic: 'Inspecting Cargo',
    question: 'How soon after beginning a trip must a driver re-inspect the cargo and its securing devices, per Section 3.1?',
    choice_a: 'Within the first 50 miles',
    choice_b: 'Within 100 miles',
    choice_c: 'Within 25 miles',
    choice_d: 'Within 200 miles',
    correct_choice: 'A',
    explanation: 'Section 3.1 states you must inspect the cargo and its securing devices again within the first 50 miles after beginning a trip, making any needed adjustments.',
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 3.1 - Inspecting Cargo"
  },
  {
    topic: 'Inspecting Cargo',
    question: 'Besides the initial post-start check, how often does Section 3.1 say a driver must re-check cargo and its securing devices during a trip?',
    choice_a: 'Only at fuel stops',
    choice_b: 'After driving 3 hours or 150 miles, and after every break taken during driving',
    choice_c: 'Only once per day',
    choice_d: 'Every 500 miles',
    correct_choice: 'B',
    explanation: 'Section 3.1 requires re-checking cargo and securing devices after driving for 3 hours or 150 miles, and after every break taken during driving.',
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 3.1 - Inspecting Cargo"
  },
  {
    topic: 'Inspecting Cargo',
    question: "According to Section 3.1, which of the following is a driver responsible for regarding cargo, whether or not they loaded and secured it themselves?",
    choice_a: "Only the shipper's paperwork",
    choice_b: 'Nothing, if a third party loaded the cargo',
    choice_c: 'Inspecting the cargo and recognizing overloads or poorly balanced weight',
    choice_d: "Only the trailer's tire pressure",
    correct_choice: 'C',
    explanation: 'Section 3.1 states the driver is responsible for inspecting cargo and recognizing overloads and poorly balanced weight, regardless of who loaded it.',
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 3.1 - Inspecting Cargo"
  },
  {
    topic: 'Inspecting Cargo',
    question: 'Per Section 3.1, what can loose cargo that falls off a vehicle cause?',
    choice_a: 'Only minor cosmetic damage',
    choice_b: 'No real hazard on limited-access highways',
    choice_c: 'Traffic problems, and it could injure or kill others',
    choice_d: 'Only an insurance claim',
    correct_choice: 'C',
    explanation: 'Section 3.1 warns that loose cargo that falls off a vehicle can cause traffic problems and others could be hurt or killed.',
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 3.1 - Inspecting Cargo"
  },
  {
    topic: 'Inspecting Cargo',
    question: 'Per Section 3.1, what must a driver have to legally haul hazardous material that requires placards on the vehicle?',
    choice_a: 'Nothing beyond a standard CDL',
    choice_b: 'A doubles/triples endorsement',
    choice_c: 'A passenger endorsement',
    choice_d: 'A hazardous materials endorsement',
    correct_choice: 'D',
    explanation: 'Section 3.1 notes that if you intend to carry hazardous material that requires placards on your vehicle, you must also have a hazardous materials endorsement.',
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 3.1 - Inspecting Cargo"
  },
  {
    topic: 'Inspecting Cargo',
    question: 'According to Section 3.1, how can improperly loaded cargo affect a commercial vehicle?',
    choice_a: 'It only affects fuel economy',
    choice_b: 'It has no effect on handling if the load is tarped',
    choice_c: 'It only matters for tank vehicles',
    choice_d: 'It can affect steering, making the vehicle more difficult to control',
    correct_choice: 'D',
    explanation: 'Section 3.1 states steering could be affected by how a vehicle is loaded, making it more difficult to control the vehicle.',
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 3.1 - Inspecting Cargo"
  }
];

const tankAdd = [
  {
    topic: 'Inspecting Tank Vehicles',
    question: 'Per Section 8.1.1, what is the most important item to check on all tank vehicles during inspection?',
    choice_a: 'Leaks',
    choice_b: 'Tire tread depth',
    choice_c: 'Mirror alignment',
    choice_d: 'Fuel gauge accuracy',
    correct_choice: 'A',
    explanation: 'Section 8.1.1 states that on all tank vehicles, the most important item to check for is leaks, checking under and around the vehicle for signs of leaking.',
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 8.1.1 - Leaks"
  },
  {
    topic: 'Inspecting Tank Vehicles',
    question: 'According to Section 8.1, a driver should never drive a tank vehicle with what condition?',
    choice_a: 'A full fuel tank',
    choice_b: 'Open valves or manhole covers',
    choice_c: 'Cold tires',
    choice_d: 'A loaded trailer',
    correct_choice: 'B',
    explanation: 'Section 8.1 warns never to drive a tank vehicle with open valves or manhole covers.',
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 8.1 - Inspecting Tank Vehicles"
  },
  {
    topic: 'Inspecting Tank Vehicles',
    question: 'Per Section 8.1.3, what should a driver check regarding special equipment on a tank vehicle?',
    choice_a: 'Nothing, tank vehicles carry no special equipment',
    choice_b: 'Only the spare tire',
    choice_c: 'That the required emergency equipment for the vehicle is present and works',
    choice_d: "Only the tank vehicle's paint condition",
    correct_choice: 'C',
    explanation: 'Section 8.1.3 instructs drivers to find out what emergency equipment is required for their vehicle, make sure they have it, and that it works.',
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 8.1.3 - Special Equipment"
  },
  {
    topic: 'Inspecting Tank Vehicles',
    question: 'Section 8.1 notes that tank vehicles come in many types and sizes. What should a driver consult to know how to properly inspect a specific tank vehicle?',
    choice_a: "Another driver's opinion",
    choice_b: 'The shipping papers only',
    choice_c: 'A generic pre-trip checklist for straight trucks',
    choice_d: "The vehicle's operator manual",
    correct_choice: 'D',
    explanation: "Section 8.1 states you need to check the vehicle's operator manual to make sure you know how to inspect your specific tank vehicle.",
    weight: 3,
    source_note: "Wisconsin Commercial Driver's Manual (May 2026), Section 8.1 - Inspecting Tank Vehicles"
  }
];

const cargoPath = 'C:/claudews/passexamhq/Workers/passexamhq-api/scratchpad/questions/wi_cdl/04_cargo.json';
const tankPath = 'C:/claudews/passexamhq/Workers/passexamhq-api/scratchpad/questions/wi_cdl/09_tank.json';
const cargo = JSON.parse(fs.readFileSync(cargoPath, 'utf8'));
const tank = JSON.parse(fs.readFileSync(tankPath, 'utf8'));
fs.writeFileSync(cargoPath, JSON.stringify(cargo.concat(cargoAdd), null, 2) + '\n');
fs.writeFileSync(tankPath, JSON.stringify(tank.concat(tankAdd), null, 2) + '\n');
console.log('cargo now:', cargo.length + cargoAdd.length);
console.log('tank now:', tank.length + tankAdd.length);
