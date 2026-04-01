"use strict";

const { compactText, fetchJsonWithRetry, formatTimestamp } = require("./http");

/**
 * Effettua una ricerca pubblica su Reddit per ottenere sentiment contestuale.
 * @param {{ symbol: string, company: string, keywords: string[], limit?: number }} input
 * @returns {Promise<any[]>}
 */
async function fetchRedditMentions(input) {
  const limit = Math.max(2, Math.min(8, Number(input.limit) || 4));
  const query = buildQuery(input.symbol, input.company, input.keywords || []);
  const url =
    "https://www.reddit.com/search.json" +
    `?q=${encodeURIComponent(query)}` +
    `&limit=${limit}` +
    "&sort=new&raw_json=1&restrict_sr=false&type=link";

  const payload = await fetchJsonWithRetry(url, {}, { retries: 1, backoffMs: 450 });
  const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];

  return children
    .map((child) => normalizeRedditPost(child?.data))
    .filter(Boolean)
    .slice(0, limit);
}

function buildQuery(symbol, company, keywords) {
  const parts = [symbol, company]
    .concat(keywords || [])
    .map((value) => compactText(value))
    .filter(Boolean)
    .slice(0, 4);

  return parts.map((part) => `"${part}"`).join(" OR ");
}

function normalizeRedditPost(entry) {
  const permalink = compactText(entry?.permalink);
  const title = compactText(entry?.title);
  if (!permalink || !title) {
    return null;
  }

  const createdAt = entry?.created_utc
    ? new Date(Number(entry.created_utc) * 1000).toISOString()
    : "";

  return {
    title,
    url: permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`,
    summary: compactText(entry?.selftext || ""),
    provider: "Reddit",
    subreddit: compactText(entry?.subreddit),
    score: Number.isFinite(Number(entry?.score)) ? Number(entry.score) : null,
    comments: Number.isFinite(Number(entry?.num_comments)) ? Number(entry.num_comments) : null,
    publishedAt: createdAt,
    publishedAtLabel: formatTimestamp(createdAt)
  };
}

module.exports = {
  fetchRedditMentions
};
