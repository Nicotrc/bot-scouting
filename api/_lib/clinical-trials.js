"use strict";

const { compactText, fetchJsonWithRetry } = require("./http");

/**
 * Recupera trial clinici recenti con API pubblica di ClinicalTrials.gov.
 * Usa l'endpoint study_fields per massima compatibilita`.
 * @param {{ company: string, keywords: string[], limit?: number }} input
 * @returns {Promise<any[]>}
 */
async function fetchClinicalTrials(input) {
  const limit = Math.max(2, Math.min(6, Number(input.limit) || 4));
  const searchTerm = buildExpression(input.company, input.keywords || []);
  if (!searchTerm) {
    return [];
  }

  const url =
    "https://clinicaltrials.gov/api/query/study_fields" +
    `?expr=${encodeURIComponent(searchTerm)}` +
    "&fields=NCTId,BriefTitle,Condition,Phase,PrimaryCompletionDate,OverallStatus,LeadSponsorName" +
    `&min_rnk=1&max_rnk=${limit}` +
    "&fmt=json";

  const payload = await fetchJsonWithRetry(url, {}, { retries: 2, backoffMs: 450 });
  const studies = Array.isArray(payload?.StudyFieldsResponse?.StudyFields)
    ? payload.StudyFieldsResponse.StudyFields
    : [];

  return studies
    .map((study) => normalizeStudy(study))
    .filter(Boolean)
    .slice(0, limit);
}

function buildExpression(company, keywords) {
  const parts = [company]
    .concat(keywords || [])
    .map((value) => compactText(value))
    .filter(Boolean)
    .slice(0, 4);

  return parts.join(" OR ");
}

function normalizeStudy(study) {
  const nctId = firstValue(study?.NCTId);
  const title = firstValue(study?.BriefTitle);
  if (!nctId || !title) {
    return null;
  }

  const phase = firstValue(study?.Phase) || "Phase n/d";
  const status = firstValue(study?.OverallStatus) || "Status n/d";
  const condition = firstValue(study?.Condition);
  const sponsor = firstValue(study?.LeadSponsorName);
  const primaryCompletionDate = firstValue(study?.PrimaryCompletionDate);

  return {
    title,
    url: `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`,
    provider: "ClinicalTrials.gov",
    phase,
    filingDate: primaryCompletionDate,
    detail: [phase, status, condition].filter(Boolean).join(" · "),
    summary: compactText(`${status}${condition ? ` | ${condition}` : ""}${sponsor ? ` | sponsor: ${sponsor}` : ""}`)
  };
}

function firstValue(value) {
  return Array.isArray(value) ? compactText(value[0]) : compactText(value);
}

module.exports = {
  fetchClinicalTrials
};
