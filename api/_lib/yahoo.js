"use strict";

const { compactText, fetchJsonWithRetry, formatTimestamp } = require("./http");

const ALLOWED_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
const ALLOWED_INTERVALS = new Set(["1d", "1wk", "1mo"]);

/**
 * Recupera news da Yahoo Finance.
 * @param {string} symbol
 * @param {number} limit
 * @returns {Promise<any[]>}
 */
async function fetchYahooNews(symbol, limit = 6) {
  let lastError = "Yahoo Finance news request failed.";

  for (const candidate of buildSymbolCandidates(symbol)) {
    const encoded = encodeURIComponent(candidate);
    const url =
      "https://query1.finance.yahoo.com/v1/finance/search" +
      `?q=${encoded}` +
      "&quotesCount=1" +
      `&newsCount=${Math.max(1, Math.min(12, limit))}` +
      "&enableFuzzyQuery=false&lang=en-US&region=US";

    try {
      const payload = await fetchJsonWithRetry(url, {}, { retries: 2, backoffMs: 300 });
      const items = normalizeNewsItems(payload?.news || [], limit);
      if (items.length) {
        return items;
      }
      lastError = "No Yahoo Finance news found.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

/**
 * Recupera OHLCV da Yahoo Finance.
 * @param {string} symbol
 * @param {string} rangeValue
 * @param {string} interval
 * @returns {Promise<any[]>}
 */
async function fetchYahooChartRows(symbol, rangeValue = "6mo", interval = "1d") {
  const safeRange = ALLOWED_RANGES.has(rangeValue) ? rangeValue : "6mo";
  const safeInterval = ALLOWED_INTERVALS.has(interval) ? interval : "1d";
  let lastError = "Yahoo Finance chart request failed.";

  for (const candidate of buildSymbolCandidates(symbol)) {
    const encoded = encodeURIComponent(candidate);
    for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
      const url =
        `https://${host}/v8/finance/chart/${encoded}` +
        `?range=${encodeURIComponent(safeRange)}` +
        `&interval=${encodeURIComponent(safeInterval)}` +
        "&includeAdjustedClose=true&lang=en-US&region=US";

      try {
        const payload = await fetchJsonWithRetry(url, {}, { retries: 2, backoffMs: 350 });
        const chart = payload?.chart || {};
        const result = Array.isArray(chart.result) ? chart.result[0] : null;
        if (!result) {
          lastError = chart?.error?.description || chart?.error?.code || lastError;
          continue;
        }

        const rows = normalizeChartRows(candidate, result);
        if (rows.length >= 30) {
          return rows;
        }
        lastError = "Too few Yahoo Finance chart rows.";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new Error(lastError);
}

function normalizeNewsItems(entries, limit) {
  const seen = new Set();
  const items = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const url =
      entry?.link ||
      entry?.clickThroughUrl?.url ||
      entry?.canonicalUrl?.url ||
      "";
    const title = compactText(entry?.title);
    if (!title || !url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    const publishedAt = entry?.providerPublishTime
      ? new Date(entry.providerPublishTime * 1000).toISOString()
      : "";

    items.push({
      title,
      url,
      summary: compactText(entry?.summary || entry?.description || ""),
      provider: compactText(entry?.publisher || "Yahoo Finance"),
      publishedAt,
      publishedAtLabel: formatTimestamp(publishedAt)
    });

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

function normalizeChartRows(symbol, result) {
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const close = toNumber(quote?.close?.[index]);
    if (!Number.isFinite(close)) {
      continue;
    }
    const open = fallbackNumber(quote?.open?.[index], close);
    const high = Math.max(fallbackNumber(quote?.high?.[index], close), open, close);
    const low = Math.min(fallbackNumber(quote?.low?.[index], close), open, close);
    const volume = fallbackNumber(quote?.volume?.[index], 0);

    rows.push({
      symbol,
      date: new Date(Number(timestamps[index]) * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume
    });
  }

  return rows;
}

function buildSymbolCandidates(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) {
    return [];
  }
  if (normalized.startsWith("^")) {
    return [normalized, normalized.replace(/^\^+/, "")];
  }
  return /^[A-Z0-9.=_-]{1,15}$/.test(normalized)
    ? [normalized, `^${normalized}`]
    : [normalized];
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function fallbackNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(fallback);
}

module.exports = {
  fetchYahooChartRows,
  fetchYahooNews
};
