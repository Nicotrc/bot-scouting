"use strict";

const reportDataset = require("../data/weekly-reports.json");
const { readString, sendJson, setJsonHeaders } = require("./_lib/http");

module.exports = async function handler(req, res) {
  setJsonHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const body = normalizeBody(req.body);
  const weekId = readString({ query: req.query, body }, "weekId") || reportDataset?.meta?.defaultWeekId || "";
  const currentSymbol = readString({ query: req.query, body }, "symbol").toUpperCase();
  const question = readString({ query: req.query, body }, "question");
  const intel = body?.intel && typeof body.intel === "object" ? body.intel : null;

  if (!question) {
    sendJson(res, 400, { error: "Missing question" });
    return;
  }

  const report = resolveReport(weekId);
  if (!report) {
    sendJson(res, 404, { error: `Week ${weekId} not found` });
    return;
  }

  const intent = classifyIntent(question);
  const symbol = resolveSymbol(question, report, currentSymbol);
  const item = symbol ? resolveItem(report, symbol) : null;
  const answer = buildAnswer({ report, item, symbol, question, intent, intel });

  sendJson(res, 200, { answer });
};

function normalizeBody(body) {
  if (!body) {
    return {};
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (_error) {
      return {};
    }
  }
  return typeof body === "object" ? body : {};
}

function resolveReport(weekId) {
  return (reportDataset.reports || []).find((report) => report.id === weekId) || null;
}

function resolveItem(report, symbol) {
  return (report.watchlist || []).find((entry) => entry.symbol === symbol) || null;
}

function resolveSymbol(question, report, currentSymbol) {
  const upper = String(question || "").toUpperCase();
  const symbols = (report.watchlist || []).map((item) => item.symbol)
    .concat((report.removed || []).map((item) => item.symbol));

  const explicit = symbols.find((symbol) => upper.includes(symbol));
  return explicit || currentSymbol || "";
}

function classifyIntent(question) {
  const lower = String(question || "").toLowerCase();
  if (/(perche|why|thesis|investment)/.test(lower)) {
    return "thesis";
  }
  if (/(cosa e cambiato|settimana precedente|vs settimana|update)/.test(lower)) {
    return "change";
  }
  if (/(rischio|downside|diluizione|binary|politic)/.test(lower)) {
    return "risk";
  }
  if (/(entry|stop|target|setup|accumulo|uscita)/.test(lower)) {
    return "setup";
  }
  if (/(fonti|reddit|sec|clinical|notizie|news|forum)/.test(lower)) {
    return "sources";
  }
  if (/(allocare|mantenere|ridurre|portafoglio|portfolio)/.test(lower)) {
    return "portfolio";
  }
  if (/(miglior rischio|risk.?reward|piu speculativo|piu difensivo|ranking)/.test(lower)) {
    return "ranking";
  }
  if (/(rimoss|uscit|esclus)/.test(lower)) {
    return "removed";
  }
  return "overview";
}

function buildAnswer(context) {
  const { report, item, symbol, intent, intel } = context;

  if (intent === "removed") {
    return buildRemovedAnswer(report);
  }

  if (intent === "portfolio") {
    return buildPortfolioAnswer(report, item);
  }

  if (intent === "ranking") {
    return buildRankingAnswer(report, item);
  }

  if (!item) {
    return `Nel report ${report.weekLabel} non trovo il ticker richiesto. Titoli attivi: ${(report.watchlist || []).map((entry) => entry.symbol).join(", ")}.`;
  }

  if (intent === "thesis") {
    return buildThesisAnswer(report, item);
  }

  if (intent === "change") {
    return buildChangeAnswer(item);
  }

  if (intent === "risk") {
    return buildRiskAnswer(item);
  }

  if (intent === "setup") {
    return buildSetupAnswer(item);
  }

  if (intent === "sources") {
    return buildSourcesAnswer(item, intel);
  }

  return buildOverviewAnswer(report, item, symbol, intel);
}

function buildThesisAnswer(report, item) {
  return [
    `${item.symbol} e\` nel report ${report.weekLabel} per tre motivi.`,
    `1. Thesis: ${item.thesis}`,
    `2. Catalyst: ${item.catalyst} con finestra ${item.catalystWindow}.`,
    `3. Valuation gap: prezzo ${item.valuationGap.current}, target ${item.valuationGap.target}, upside ${item.valuationGap.upside}.`
  ].join("\n");
}

function buildChangeAnswer(item) {
  const history = (item.history || [])
    .map((entry) => `${entry.weekId}: ${entry.price} · ${entry.status} · ${entry.scenario}`)
    .join(" | ");

  return [
    `${item.symbol} vs settimana precedente: ${item.updateVsPrevious}`,
    `Tracking storico: ${history || "nessuna serie storica disponibile."}`
  ].join("\n");
}

function buildRiskAnswer(item) {
  return [
    `${item.symbol} · rischio principale: ${item.primaryRisk}.`,
    `Binary risk: ${item.riskAnalysis.binaryRisk}. Political risk: ${item.riskAnalysis.politicalRisk}. Dilution risk: ${item.riskAnalysis.dilutionRisk}.`,
    `Downside realistico: ${item.riskAnalysis.downside}.`,
    `Note operative: ${(item.riskAnalysis.notes || []).join(" ")}`
  ].join("\n");
}

function buildSetupAnswer(item) {
  return [
    `${item.symbol} · setup operativo aggiornato.`,
    `Entry: ${item.setup.entry}.`,
    `Stop: ${item.setup.stop}.`,
    `Target: ${item.setup.target}.`,
    `Strategia: ${item.setup.strategy}.`
  ].join("\n");
}

function buildSourcesAnswer(item, intel) {
  const liveNotes = buildIntelDigest(intel);
  return [
    `${item.symbol} · fonti interne al report: ${(item.sourceNotes || []).join(" ") || "nessuna nota aggiuntiva."}`,
    liveNotes || "Nessuna evidenza live disponibile nella sessione corrente."
  ].join("\n");
}

function buildPortfolioAnswer(report, item) {
  const lines = (report.portfolioImplication || [])
    .map((entry) => `${entry.bucket}: ${entry.symbol} · ${entry.body}`);

  if (!item) {
    return lines.join("\n");
  }

  const direct = lines.find((line) => line.includes(item.symbol));
  return direct
    ? `${item.symbol} · implicazione di portafoglio.\n${direct}`
    : `Per ${item.symbol} non c'e\` una bucket dedicata. Usa la regola generale del report:\n${lines.join("\n")}`;
}

function buildRankingAnswer(report, item) {
  const ranking = report.riskRanking || {};
  const lines = [
    `Piu\` difensivo: ${ranking.mostDefensive?.symbol || "n/d"} · ${ranking.mostDefensive?.reason || ""}`,
    `Piu\` speculativo: ${ranking.mostSpeculative?.symbol || "n/d"} · ${ranking.mostSpeculative?.reason || ""}`,
    `Miglior rischio/rendimento: ${ranking.bestRiskReward?.symbol || "n/d"} · ${ranking.bestRiskReward?.reason || ""}`
  ];

  if (!item) {
    return lines.join("\n");
  }

  return `${item.symbol} nel ranking del desk:\n${lines.join("\n")}`;
}

function buildRemovedAnswer(report) {
  const removed = report.removed || [];
  if (!removed.length) {
    return `Nel report ${report.weekLabel} non ci sono titoli rimossi.`;
  }
  return removed
    .map((entry) => `${entry.symbol}: ${entry.reason}`)
    .join("\n");
}

function buildOverviewAnswer(report, item, symbol, intel) {
  return [
    `${symbol || item.symbol} · overview ${report.weekLabel}.`,
    `Thesis: ${item.thesis}`,
    `Update: ${item.updateVsPrevious}`,
    `Catalyst: ${item.catalyst} (${item.catalystWindow}).`,
    `Rischio #1: ${item.primaryRisk}. Setup: ${item.setup.entry} / stop ${item.setup.stop} / target ${item.setup.target}.`,
    buildIntelDigest(intel)
  ]
    .filter(Boolean)
    .join("\n");
}

function buildIntelDigest(intel) {
  if (!intel || typeof intel !== "object") {
    return "";
  }

  const parts = [];
  if (Array.isArray(intel.summary) && intel.summary.length) {
    parts.push(`Read-through live: ${intel.summary.join(" ")}`);
  }

  const firstNews = intel?.feeds?.news?.[0];
  if (firstNews) {
    parts.push(`News: ${firstNews.title}`);
  }

  const firstReg = intel?.feeds?.regulatory?.[0];
  if (firstReg) {
    parts.push(`Fonte regolatoria: ${firstReg.title}`);
  }

  const firstFiling = intel?.feeds?.filings?.[0];
  if (firstFiling) {
    parts.push(`Filing: ${firstFiling.title}`);
  }

  const firstReddit = intel?.feeds?.reddit?.[0];
  if (firstReddit) {
    parts.push(`Forum: ${firstReddit.title}`);
  }

  return parts.join(" ");
}
