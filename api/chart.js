"use strict";

const USER_AGENT = "Mozilla/5.0";
const ALLOWED_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
const ALLOWED_INTERVALS = new Set(["1d", "1wk", "1mo"]);

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const symbol = readQuery(req, "symbol").trim();
  const rangeValue = readQuery(req, "range").trim() || "6mo";
  const interval = readQuery(req, "interval").trim() || "1d";

  if (!symbol) {
    sendJson(res, 400, { error: "Missing symbol" });
    return;
  }

  try {
    const payload = await fetchChartPayload(symbol, rangeValue, interval);
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, { error: error instanceof Error ? error.message : "Yahoo Finance request failed." });
  }
};

function setCors(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function sendJson(res, status, payload) {
  res.status(status).send(JSON.stringify(payload));
}

function readQuery(req, key) {
  const value = req.query?.[key];
  if (Array.isArray(value)) {
    return String(value[0] || "");
  }
  return String(value || "");
}

async function fetchChartPayload(symbol, rangeValue, interval) {
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
        const response = await fetchJson(url);
        const chart = response?.chart || {};
        const result = Array.isArray(chart.result) ? chart.result : [];
        if (!result.length) {
          lastError = chart.error?.description || chart.error?.code || lastError;
          continue;
        }
        return normalizeChartPayload(symbol, candidate, result[0]);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new Error(lastError);
}

function normalizeChartPayload(requestedSymbol, resolvedSymbol, data) {
  const meta = data?.meta || {};
  const timestamps = Array.isArray(data?.timestamp) ? data.timestamp : [];
  const quote = data?.indicators?.quote?.[0] || {};
  const opens = Array.isArray(quote.open) ? quote.open : [];
  const highs = Array.isArray(quote.high) ? quote.high : [];
  const lows = Array.isArray(quote.low) ? quote.low : [];
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];
  const rows = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const close = safeListValue(closes, index);
    if (close == null || Number.isNaN(Number(close))) {
      continue;
    }
    const closeValue = Number(close);
    const openValue = coalesceNumber(safeListValue(opens, index), closeValue);
    const highValue = coalesceNumber(safeListValue(highs, index), Math.max(openValue, closeValue));
    const lowValue = coalesceNumber(safeListValue(lows, index), Math.min(openValue, closeValue));
    const volumeValue = coalesceNumber(safeListValue(volumes, index), 0);
    rows.push({
      date: new Date(Number(timestamps[index]) * 1000).toISOString(),
      open: openValue,
      high: Math.max(highValue, openValue, closeValue),
      low: Math.min(lowValue, openValue, closeValue),
      close: closeValue,
      volume: volumeValue,
      symbol: resolvedSymbol
    });
  }

  if (rows.length < 30) {
    throw new Error("Yahoo Finance returned too few data points.");
  }

  return {
    provider: "Yahoo Finance",
    requestedSymbol,
    resolvedSymbol: meta.symbol || resolvedSymbol,
    longName: meta.longName || meta.shortName || requestedSymbol,
    instrumentType: meta.instrumentType || "UNKNOWN",
    currency: meta.currency || "",
    rows
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json,text/plain,*/*"
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Yahoo request failed with status ${response.status}.`);
  }
  if (body.includes("Too Many Requests")) {
    throw new Error("Yahoo Finance rate limit reached. Retry in a minute.");
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("Yahoo Finance returned an invalid JSON payload.");
  }
  return payload;
}

function buildSymbolCandidates(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) {
    return [];
  }
  if (normalized.startsWith("^")) {
    return [normalized, normalized.replace(/^\^+/, "")];
  }
  if (/^[A-Z0-9.=_-]{1,15}$/.test(normalized)) {
    return [normalized, `^${normalized}`];
  }
  return [normalized];
}

function safeListValue(values, index) {
  return index < values.length ? values[index] : null;
}

function coalesceNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}
