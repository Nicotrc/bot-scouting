"use strict";

const { compactText, fetchJsonWithRetry } = require("./http");

let companyTickerPromise = null;

/**
 * Recupera filing recenti SEC per ticker quotati USA.
 * @param {{ symbol: string, limit?: number }} input
 * @returns {Promise<any[]>}
 */
async function fetchSecFilings(input) {
  const limit = Math.max(2, Math.min(6, Number(input.limit) || 4));
  const symbol = String(input.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return [];
  }

  const company = await resolveCompany(symbol);
  if (!company?.cik) {
    return [];
  }

  const cikPadded = String(company.cik).padStart(10, "0");
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cikPadded}.json`;
  const payload = await fetchJsonWithRetry(submissionsUrl, {}, { retries: 2, backoffMs: 400 });
  const recent = payload?.filings?.recent || {};
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const dates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const documents = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
  const descriptions = Array.isArray(recent.primaryDocDescription) ? recent.primaryDocDescription : [];
  const items = [];

  for (let index = 0; index < forms.length; index += 1) {
    const form = compactText(forms[index]);
    if (!["8-K", "10-Q", "10-K", "6-K", "S-3", "424B5"].includes(form)) {
      continue;
    }
    const filingDate = compactText(dates[index]);
    const accession = compactText(accessions[index]);
    const primaryDocument = compactText(documents[index]);
    const archiveUrl = buildArchiveUrl(company.cik, accession, primaryDocument);
    items.push({
      title: `${form} · ${company.title}`,
      url: archiveUrl,
      provider: "SEC",
      filingDate,
      detail: compactText(descriptions[index] || "Recent SEC filing"),
      summary: compactText(descriptions[index] || `Filing ${form} depositato il ${filingDate}.`)
    });
    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

async function resolveCompany(symbol) {
  const map = await loadCompanyTickers();
  return map.get(symbol) || null;
}

async function loadCompanyTickers() {
  if (!companyTickerPromise) {
    companyTickerPromise = fetchJsonWithRetry("https://www.sec.gov/files/company_tickers.json", {}, { retries: 2, backoffMs: 450 })
      .then((payload) => {
        const map = new Map();
        Object.values(payload || {}).forEach((entry) => {
          const ticker = compactText(entry?.ticker).toUpperCase();
          if (!ticker) {
            return;
          }
          map.set(ticker, {
            cik: Number(entry?.cik_str || 0),
            title: compactText(entry?.title),
            ticker
          });
        });
        return map;
      });
  }
  return companyTickerPromise;
}

function buildArchiveUrl(cik, accession, primaryDocument) {
  if (!cik || !accession || !primaryDocument) {
    return "https://www.sec.gov/edgar/search/";
  }
  const numericCik = String(Number(cik));
  const normalizedAccession = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${numericCik}/${normalizedAccession}/${primaryDocument}`;
}

module.exports = {
  fetchSecFilings
};
