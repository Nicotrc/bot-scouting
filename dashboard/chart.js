const USER_AGENT = "Mozilla/5.0";
const VALID_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
const VALID_INTERVALS = new Set(["1d", "1wk", "1mo"]);

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const symbol = String(req.query.symbol || "").trim();
  const range = VALID_RANGES.has(req.query.range) ? req.query.range : "6mo";
  const interval = VALID_INTERVALS.has(req.query.interval) ? req.query.interval : "1d";

  if (!symbol) {
    res.status(400).json({ error: "Missing symbol" });
    return;
  }

  try {
    const payload = await fetchChartPayload(symbol, range, interval);
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({ error: error.message || "Yahoo Finance chart request failed." });
  }
};

async function fetchChartPayload(symbol, range, interval) {
  let lastError = "Yahoo Finance chart request failed.";
  for (const candidate of buildSymbolCandidates(symbol)) {
    for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
      const url =
        `https://${host}/v8/finance/chart/${encodeURIComponent(candidate)}` +
        `?range=${encodeURIComponent(range)}` +
        `&interval=${encodeURIComponent(interval)}` +
        "&includeAdjustedClose=true&lang=en-US&region=US";

      try {
        const response = await fetch(url, {
          headers: {
            "accept": "application/json",
            "user-agent": USER_AGENT
          }
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.chart?.error?.description || `Yahoo HTTP ${response.status}`);
        }
        const result = payload?.chart?.result?.[0];
        if (!result) {
          lastError = payload?.chart?.error?.description || lastError;
          continue;
        }
        return normalizeChartPayload(symbol, candidate, result);
      } catch (error) {
        lastError = error.message || lastError;
      }
    }
  }
  throw new Error(lastError);
}

function normalizeChartPayload(requestedSymbol, resolvedSymbol, data) {
  const meta = data.meta || {};
  const timestamps = data.timestamp || [];
  const quote = Array.isArray(data?.indicators?.quote) ? (data.indicators.quote[0] || {}) : {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  const rows = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const close = toNumber(closes[index]);
    if (!Number.isFinite(close)) {
      continue;
    }
    const open = fallbackNumber(opens[index], close);
    const high = fallbackNumber(highs[index], Math.max(open, close));
    const low = fallbackNumber(lows[index], Math.min(open, close));
    const volume = fallbackNumber(volumes[index], 0);
    rows.push({
      date: new Date((timestamps[index] || 0) * 1000).toISOString(),
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume,
      symbol: meta.symbol || resolvedSymbol
    });
  }

  if (rows.length < 30) {
    throw new Error("Yahoo Finance returned too few data points.");
  }

  return {
    provider: "Yahoo Finance",
    transport: "vercel:yahoo",
    requestedSymbol,
    resolvedSymbol: meta.symbol || resolvedSymbol,
    longName: meta.longName || meta.shortName || requestedSymbol,
    instrumentType: meta.instrumentType || "UNKNOWN",
    currency: meta.currency || "",
    rows
  };
}

function buildSymbolCandidates(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) {
    return [];
  }
  if (normalized.startsWith("^")) {
    return [normalized, normalized.slice(1)];
  }
  if (/^[A-Z0-9._-]{1,12}$/.test(normalized)) {
    return [normalized, `^${normalized}`];
  }
  return [normalized];
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function fallbackNumber(value, fallback) {
  const numeric = toNumber(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}
