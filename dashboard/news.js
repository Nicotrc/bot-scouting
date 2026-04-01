const USER_AGENT = "Mozilla/5.0";

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const symbol = String(req.query.symbol || "").trim();
  const limit = clampNumber(Number(req.query.limit || 8), 3, 20, 8);

  if (!symbol) {
    res.status(400).json({ error: "Missing symbol" });
    return;
  }

  try {
    const payload = await fetchNewsPayload(symbol, limit);
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({ error: error.message || "Yahoo Finance news request failed." });
  }
};

async function fetchNewsPayload(symbol, limit) {
  let lastError = "Yahoo Finance news request failed.";
  for (const candidate of buildSymbolCandidates(symbol)) {
    const url =
      "https://query1.finance.yahoo.com/v1/finance/search" +
      `?q=${encodeURIComponent(candidate)}` +
      "&quotesCount=1" +
      `&newsCount=${encodeURIComponent(String(limit))}` +
      "&enableFuzzyQuery=false&lang=en-US&region=US";

    try {
      const response = await fetch(url, {
        headers: {
          "accept": "application/json",
          "user-agent": USER_AGENT
        }
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || `Yahoo HTTP ${response.status}`);
      }
      const items = normalizeNewsItems(payload.news || [], limit);
      if (items.length) {
        return {
          provider: "Yahoo Finance",
          transport: "vercel:yahoo",
          requestedSymbol: symbol,
          resolvedSymbol: candidate,
          items
        };
      }
      lastError = "No news items found.";
    } catch (error) {
      lastError = error.message || lastError;
    }
  }
  throw new Error(lastError);
}

function normalizeNewsItems(entries, limit) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const url = entry.link || entry?.clickThroughUrl?.url || entry?.canonicalUrl?.url || "";
      if (!entry.title || !url || seen.has(url)) {
        return null;
      }
      seen.add(url);
      const publishedAt = entry.providerPublishTime
        ? new Date(entry.providerPublishTime * 1000).toISOString()
        : "";
      return {
        title: entry.title,
        summary: String(entry.summary || entry.description || "").trim(),
        provider: entry.publisher || "Yahoo Finance",
        publishedAt,
        publishedAtLabel: formatTimestamp(publishedAt),
        url
      };
    })
    .filter(Boolean)
    .slice(0, limit);
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

function clampNumber(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function formatTimestamp(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}
