"use strict";

const USER_AGENT = "Mozilla/5.0";

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const symbol = readQuery(req, "symbol").trim();
  const limitRaw = readQuery(req, "limit").trim();
  const limit = clampLimit(limitRaw);

  if (!symbol) {
    sendJson(res, 400, { error: "Missing symbol" });
    return;
  }

  try {
    const payload = await fetchNewsPayload(symbol, limit);
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, { error: error instanceof Error ? error.message : "Yahoo Finance news request failed." });
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

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 8;
  }
  return Math.max(3, Math.min(20, parsed));
}

async function fetchNewsPayload(symbol, limit) {
  let lastError = "Yahoo Finance news request failed.";

  for (const candidate of buildSymbolCandidates(symbol)) {
    const encoded = encodeURIComponent(candidate);
    const url =
      "https://query1.finance.yahoo.com/v1/finance/search" +
      `?q=${encoded}` +
      "&quotesCount=1" +
      `&newsCount=${limit}` +
      "&enableFuzzyQuery=false&lang=en-US&region=US";

    try {
      const payload = await fetchJson(url);
      const items = normalizeNewsItems(payload?.news || [], limit);
      if (items.length) {
        return {
          provider: "Yahoo Finance",
          transport: "bridge:yahoo",
          requestedSymbol: symbol,
          resolvedSymbol: candidate,
          items
        };
      }
      lastError = "No news items found.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

function normalizeNewsItems(entries, limit) {
  const items = [];
  const seenUrls = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const title = entry?.title;
    const urlValue =
      entry?.link ||
      entry?.clickThroughUrl?.url ||
      entry?.canonicalUrl?.url ||
      "";
    if (!title || !urlValue || seenUrls.has(urlValue)) {
      continue;
    }
    seenUrls.add(urlValue);
    const publishedSeconds = entry?.providerPublishTime;
    const publishedAt =
      typeof publishedSeconds === "number" && Number.isFinite(publishedSeconds)
        ? new Date(publishedSeconds * 1000).toISOString()
        : "";
    items.push({
      title,
      summary: String(entry?.summary || entry?.description || "").trim(),
      provider: entry?.publisher || "Yahoo Finance",
      publishedAt,
      publishedAtLabel: formatNewsTimestamp(publishedAt),
      url: urlValue
    });
    if (items.length >= limit) {
      break;
    }
  }
  return items;
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

function formatNewsTimestamp(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hour = String(parsed.getUTCHours()).padStart(2, "0");
  const minute = String(parsed.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}
