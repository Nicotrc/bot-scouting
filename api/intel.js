"use strict";

const { fetchClinicalTrials } = require("./_lib/clinical-trials");
const { fetchRedditMentions } = require("./_lib/reddit");
const { fetchSecFilings } = require("./_lib/sec");
const { readBoolean, readKeywordList, readString, sendJson, setJsonHeaders } = require("./_lib/http");
const { fetchYahooNews } = require("./_lib/yahoo");

module.exports = async function handler(req, res) {
  setJsonHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const symbol = readString(req, "symbol").toUpperCase();
  const company = readString(req, "company");
  const sector = readString(req, "sector").toLowerCase();
  const keywords = readKeywordList(req, "keywords");
  const useMock = readBoolean(req, "mock") || process.env.MOCK_INTEL === "1";

  if (!symbol) {
    sendJson(res, 400, { error: "Missing symbol" });
    return;
  }

  if (useMock) {
    sendJson(res, 200, buildMockIntel(symbol, company, sector, keywords));
    return;
  }

  try {
    const [news, reddit, filings, regulatory] = await Promise.all([
      fetchYahooNews(symbol, 4).catch(() => []),
      fetchRedditMentions({ symbol, company, keywords, limit: 4 }).catch(() => []),
      fetchSecFilings({ symbol, limit: 4 }).catch(() => []),
      sector === "biotech"
        ? fetchClinicalTrials({ company, keywords, limit: 4 }).catch(() => [])
        : Promise.resolve([])
    ]);

    const payload = {
      fetchedAt: new Date().toISOString(),
      symbol,
      company,
      sector,
      providers: buildProviders(news, reddit, filings, regulatory),
      summary: buildSummary(symbol, sector, { news, reddit, filings, regulatory }),
      feeds: {
        news,
        reddit,
        regulatory,
        filings
      }
    };

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, {
      error: error instanceof Error ? error.message : "Intel aggregation failed.",
      fallback: buildMockIntel(symbol, company, sector, keywords)
    });
  }
};

function buildProviders(news, reddit, filings, regulatory) {
  return [
    news.length ? "Yahoo Finance" : "",
    reddit.length ? "Reddit" : "",
    regulatory.length ? "ClinicalTrials.gov" : "",
    filings.length ? "SEC" : ""
  ].filter(Boolean);
}

function buildSummary(symbol, sector, feeds) {
  const notes = [];
  if (feeds.news.length) {
    notes.push(`${symbol}: ${feeds.news.length} notizie Yahoo recenti per leggere il tono di mercato.`);
  }
  if (feeds.reddit.length) {
    notes.push(`${symbol}: ${feeds.reddit.length} menzioni Reddit per intercettare hype o stress del sentiment retail.`);
  }
  if (sector === "biotech") {
    if (feeds.regulatory.length) {
      notes.push(`${symbol}: evidenza regolatoria/clinica disponibile su ClinicalTrials.gov.`);
    } else {
      notes.push(`${symbol}: nessun trial clinico recente emerso dal fetch automatico, verificare manualmente la pipeline.`);
    }
  } else if (feeds.filings.length) {
    notes.push(`${symbol}: filing SEC recenti disponibili per leggere contratti, capital raising o update societari.`);
  }
  if (!notes.length) {
    notes.push(`${symbol}: nessuna fonte esterna disponibile in questo refresh, usare il dataset locale come fallback.`);
  }
  return notes;
}

function buildMockIntel(symbol, company, sector, keywords) {
  const cleanCompany = company || symbol;
  return {
    fetchedAt: new Date().toISOString(),
    symbol,
    company: cleanCompany,
    sector,
    providers: ["Mock fallback"],
    summary: [
      `${symbol}: modalita\` mock attiva. Il desk usa un fallback deterministico per testing offline e review UI.`,
      `Keywords attive: ${(keywords || []).join(", ") || "nessuna parola chiave aggiuntiva"}.`
    ],
    feeds: {
      news: [
        {
          title: `${cleanCompany} · placeholder Yahoo context`,
          url: "#",
          provider: "Mock",
          publishedAtLabel: "offline",
          summary: "Voce generata per test locale della UI quando le fonti esterne non sono raggiungibili."
        }
      ],
      reddit: [
        {
          title: `${symbol} discussion placeholder`,
          url: "https://www.reddit.com/",
          provider: "Mock",
          subreddit: "stocks",
          score: 12,
          publishedAtLabel: "offline",
          summary: "Usare il mock per verificare il layout della sezione forum."
        }
      ],
      regulatory: sector === "biotech"
        ? [
            {
              title: `${cleanCompany} clinical placeholder`,
              url: "https://clinicaltrials.gov/",
              provider: "Mock",
              detail: "Phase n/d · status n/d",
              summary: "Placeholder clinico per testare la colonna regolatoria."
            }
          ]
        : [],
      filings: [
        {
          title: `${cleanCompany} SEC placeholder`,
          url: "https://www.sec.gov/edgar/search/",
          provider: "Mock",
          filingDate: "offline",
          summary: "Placeholder filing per test offline."
        }
      ]
    }
  };
}
