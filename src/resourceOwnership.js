// Server-side source of truth for every resource file that exists for each track (superset of
// index.js's FREE_RESOURCES, which only lists the free-to-preview subset) -- authorizes
// handleResourcesSignBatch in index.js. Must be kept in sync with the `file:`-type entries in the
// site's own RESOURCES data (site repo, wwwroot/js/app.js) -- that copy is presentation-only
// (titles/descriptions/topics), this is the actual access-control list. url:-type resources
// (external handbook links) never go through the sign-batch endpoint, so aren't listed here.
//
// Extracted into its own module (like progressQueries.js) so the authorization check itself is
// testable without spinning up the Workers runtime -- see test/resource-ownership.test.js.
export const ALL_RESOURCE_FILES = {
  ca_notary: [
    'The_Power_Behind_California_Notary_Stamps.m4a', 'Legal_Minefields_for_California_Notaries.m4a',
    'Surprising_Rules_for_California_Notaries.mp4', 'California_Notary_Fees.mp4',
    'California_Notary_Blueprint.pdf', 'California_Notary_2026_Quick_Guide.png',
    'Inside_the_2026_California_Notary_Handbook.m4a', 'The_Notary_Toolkit.mp4',
    'Why_your_California_notary_stamp_is_dangerous.m4a', 'Why_your_signature_is_just_ink.m4a',
    'How_digital_deeds_become_physical_property_records.m4a', 'Tangible_Copy_Certification.mp4',
    'California_Notary_Laws_Prevent_Property_Fraud.m4a', 'CA_Notary_Public_Lifecycle.mp4',
    'Signature_by_Mark.mp4', 'How_an_X_becomes_a_legal_signature.m4a',
    'California_Notary_Rules_for_Absent_Signers.m4a', 'Proof_of_Execution.mp4',
    'Rules_for_Immigration_Documents.m4a', 'Immigration_Documents_-_Trust_Guardians.mp4',
    'California_Notary_Rules.mp4', 'Why_California_Notaries_Demand_Your_Thumbprint.m4a',
    'CA_Powers_of_Attorney.mp4',
  ],
  ca_re_salesperson: [
    'What_Happens_When_a_CA_Broker_Gets_Sued.m4a', 'The_Money_That_Was_Never_Yours.m4a',
    'Whose_Side_Are_You_Actually_On.m4a',
  ],
  fl_re_salesperson: [
    'The_Three_Day_Clock.m4a', 'Who_Do_You_Actually_Work_For.m4a',
    'The_License_You_Can_Lose_in_an_Afternoon.m4a',
  ],
  fl_re_broker: [
    'The_Day_You_Stop_Being_Just_an_Agent.m4a', 'Whose_Money_Is_It_Really.m4a',
    'The_Price_of_Being_Wrong.m4a',
  ],
  tx_re_salesperson: [
    'The_Deal_With_Two_Sides_Texas_Intermediary_Practice.m4a', 'What_Happens_When_a_Texas_Broker_Gets_Sued.m4a',
    'Whose_Money_Is_It_Really_Trust_Accounts_in_Texas.m4a',
  ],
  tx_re_broker: [
    'Once_Youre_the_Broker.m4a', 'The_Fund_Behind_the_License.m4a', 'Whose_Office_Is_This_Really.m4a',
  ],
  ny_re_salesperson: [
    'Who_Are_You_Actually_Working_For.m4a', 'The_Money_That_Changes_Hands_Before_You_Get_Paid.m4a',
    'Owning_a_Piece_of_the_Building_vs_a_Piece_of_Paper.m4a',
  ],
  ny_re_broker: [
    'The_Brokers_Real_Exposure.m4a', 'Getting_Licensed_Staying_Licensed.m4a', 'Who_Gets_Paid_and_How.m4a',
  ],
  pa_re_salesperson: [
    'The_Commission_the_Complaint_and_the_Fund_of_Last_Resort.m4a', 'Whose_Side_Are_You_Really_On.m4a',
    'The_Rules_Nobody_Reads_Until_Theyre_in_Trouble.m4a',
  ],
  pa_re_broker: [
    'Becoming_a_Broker_What_Actually_Changes.m4a', 'The_Escrow_Account_Is_Yours_Now.m4a',
    'Designated_Agency_How_a_Broker_Becomes_a_Dual_Agent.m4a',
  ],
};

// True only if every requested file is in the given track's own catalog -- deliberately all-or-
// nothing (not "sign whichever ones are valid, drop the rest") so a request mixing one legitimate
// file with one file from a different track fails loudly instead of silently partially succeeding.
export function filesOwnedByTrack(files, examType) {
  const owned = new Set(ALL_RESOURCE_FILES[examType] || []);
  return files.every((f) => owned.has(f));
}
