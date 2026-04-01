"use strict";

const DEFAULT_USER_AGENT =
  process.env.APP_USER_AGENT ||
  "CatalystDesk/1.0 (replace-with-real-contact@example.com)";

/**
 * Applica CORS e intestazioni JSON comuni.
 * @param {import("http").ServerResponse} res
 */
function setJsonHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

/**
 * Restituisce un payload JSON al client.
 * @param {import("http").ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  setJsonHeaders(res);
  res.status(status).send(JSON.stringify(payload));
}

/**
 * Legge un parametro stringa da query o body.
 * @param {any} req
 * @param {string} key
 * @returns {string}
 */
function readString(req, key) {
  const fromQuery = req?.query?.[key];
  if (Array.isArray(fromQuery)) {
    return String(fromQuery[0] || "").trim();
  }
  if (typeof fromQuery !== "undefined") {
    return String(fromQuery || "").trim();
  }
  if (req?.body && typeof req.body[key] !== "undefined") {
    return String(req.body[key] || "").trim();
  }
  return "";
}

/**
 * Legge un array di parole chiave da query/body.
 * @param {any} req
 * @param {string} key
 * @returns {string[]}
 */
function readKeywordList(req, key) {
  const value = readString(req, key);
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Interpreta flag booleani stringa.
 * @param {any} req
 * @param {string} key
 * @returns {boolean}
 */
function readBoolean(req, key) {
  const value = readString(req, key).toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Clampa un numero per input utente.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Effettua fetch JSON con retry e backoff semplice.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ retries?: number, backoffMs?: number, userAgent?: string }} [config]
 * @returns {Promise<any>}
 */
async function fetchJsonWithRetry(url, options = {}, config = {}) {
  const retries = clampNumber(config.retries, 0, 5, 2);
  const backoffMs = clampNumber(config.backoffMs, 100, 2000, 350);
  const userAgent = config.userAgent || DEFAULT_USER_AGENT;
  let lastError = "Unknown fetch error.";

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "user-agent": userAgent,
          accept: "application/json,text/plain,*/*",
          ...(options.headers || {})
        }
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} su ${url}`);
      }
      if (text.includes("Too Many Requests")) {
        throw new Error(`Rate limit raggiunto su ${url}`);
      }

      return JSON.parse(text);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === retries) {
        break;
      }
      await sleep(backoffMs * (attempt + 1));
    }
  }

  throw new Error(lastError);
}

/**
 * Rende sicure le stringhe in output testuale.
 * @param {unknown} value
 * @returns {string}
 */
function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * Formatta un timestamp ISO in stringa leggibile.
 * @param {string} value
 * @returns {string}
 */
function formatTimestamp(value) {
  if (!value) {
    return "";
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

/**
 * Pausa non bloccante.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  DEFAULT_USER_AGENT,
  clampNumber,
  compactText,
  fetchJsonWithRetry,
  formatTimestamp,
  readBoolean,
  readKeywordList,
  readString,
  sendJson,
  setJsonHeaders,
  sleep
};
