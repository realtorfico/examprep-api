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
};

// True only if every requested file is in the given track's own catalog -- deliberately all-or-
// nothing (not "sign whichever ones are valid, drop the rest") so a request mixing one legitimate
// file with one file from a different track fails loudly instead of silently partially succeeding.
export function filesOwnedByTrack(files, examType) {
  const owned = new Set(ALL_RESOURCE_FILES[examType] || []);
  return files.every((f) => owned.has(f));
}
