const state = {
  meta: null,
  reports: [],
  selectedWeekId: "",
  selectedSymbol: "",
  quantCache: new Map(),
  intelCache: new Map(),
  chatMessages: []
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    const body = document.body;
    if (body) {
      body.innerHTML = `
        <div style="max-width:760px;margin:40px auto;padding:24px;border:1px solid rgba(255,255,255,0.12);border-radius:18px;background:#111920;color:#edf4f8;font-family:Space Grotesk, sans-serif;">
          <div style="font-family:IBM Plex Mono, monospace;font-size:11px;color:#f0b35f;letter-spacing:0.12em;text-transform:uppercase;">Errore di bootstrap</div>
          <h1 style="margin:12px 0 0;font-size:28px;letter-spacing:-0.04em;">Impossibile caricare il desk settimanale</h1>
          <p style="margin-top:12px;line-height:1.7;color:#b5c1c9;">Controlla la presenza del file <code>/data/weekly-reports.json</code> e delle API serverless. Dettaglio tecnico: ${escapeHtml(error.message || String(error))}</p>
        </div>
      `;
    }
  });
});

async function init() {
  bindElements();
  bindEvents();
  await loadReports();
  renderAll();
  seedChat();
  await Promise.all([refreshQuant(), refreshIntel()]);
}

function bindElements() {
  const ids = [
    "week-selector",
    "selected-symbol-label",
    "summary-grid",
    "macro-grid",
    "screening-strip",
    "watchlist-body",
    "watchlist-legend",
    "removed-strip",
    "detail-panel",
    "detail-status",
    "risk-ranking",
    "portfolio-implication",
    "methodology",
    "week-delta",
    "quant-state",
    "price-canvas",
    "quant-grid",
    "intel-state",
    "intel-summary",
    "intel-feeds",
    "chat-suggestions",
    "chat-messages",
    "chat-form",
    "chat-input",
    "refresh-live-btn",
    "refresh-intel-btn",
    "print-report-btn"
  ];

  ids.forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els["week-selector"].addEventListener("change", async (event) => {
    state.selectedWeekId = event.target.value;
    selectDefaultSymbolForWeek();
    renderAll();
    seedChat();
    await Promise.all([refreshQuant(), refreshIntel()]);
  });

  els["watchlist-body"].addEventListener("click", async (event) => {
    const row = event.target.closest("tr[data-symbol]");
    if (!row) {
      return;
    }
    state.selectedSymbol = row.dataset.symbol;
    renderAll();
    seedChat();
    await Promise.all([refreshQuant(), refreshIntel()]);
  });

  els["refresh-live-btn"].addEventListener("click", async () => {
    await refreshQuant(true);
  });

  els["refresh-intel-btn"].addEventListener("click", async () => {
    await refreshIntel(true);
  });

  els["chat-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = els["chat-input"].value.trim();
    if (!question) {
      return;
    }

    appendChatMessage("user", question);
    els["chat-input"].value = "";
    appendChatMessage("assistant", "Analizzo il report selezionato e le evidenze live del ticker.");

    try {
      const answer = await askChat(question);
      replaceLastAssistantMessage(answer.answer);
    } catch (error) {
      replaceLastAssistantMessage(`Non riesco a completare la risposta live. ${error.message || error}`);
    }
  });

  els["chat-suggestions"].addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-question]");
    if (!button) {
      return;
    }
    els["chat-input"].value = button.dataset.question || "";
    els["chat-form"].requestSubmit();
  });

  els["print-report-btn"].addEventListener("click", () => {
    window.print();
  });
}

async function loadReports() {
  const response = await fetch("/data/weekly-reports.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`weekly-reports.json non disponibile (${response.status}).`);
  }
  const payload = await response.json();
  state.meta = payload.meta || {};
  state.reports = Array.isArray(payload.reports) ? payload.reports : [];

  if (!state.reports.length) {
    throw new Error("Il dataset settimanale e` vuoto.");
  }

  state.selectedWeekId = state.meta.defaultWeekId || state.reports[state.reports.length - 1].id;
  buildWeekSelector();
  selectDefaultSymbolForWeek();
}

function buildWeekSelector() {
  els["week-selector"].innerHTML = state.reports
    .map((report) => {
      const selected = report.id === state.selectedWeekId ? " selected" : "";
      return `<option value="${escapeHtml(report.id)}"${selected}>${escapeHtml(report.weekLabel)} · ${escapeHtml(formatDate(report.reportDate))}</option>`;
    })
    .join("");
}

function selectDefaultSymbolForWeek() {
  const report = getSelectedReport();
  if (!report) {
    state.selectedSymbol = "";
    return;
  }

  const preferred = report.watchlist.find((item) => item.status !== "In uscita") || report.watchlist[0];
  const currentSymbolExists = report.watchlist.some((item) => item.symbol === state.selectedSymbol);
  state.selectedSymbol = currentSymbolExists ? state.selectedSymbol : preferred?.symbol || "";
}

function renderAll() {
  renderHeaderMeta();
  renderSummary();
  renderWatchlist();
  renderDetail();
  renderRiskRanking();
  renderPortfolio();
  renderMethodology();
  renderWeekDelta();
}

function renderHeaderMeta() {
  const report = getSelectedReport();
  const selectedItem = getSelectedItem();
  els["selected-symbol-label"].textContent = selectedItem
    ? `${selectedItem.symbol} · ${selectedItem.company}`
    : report?.weekLabel || "N/D";
}

function renderSummary() {
  const report = getSelectedReport();
  if (!report) {
    return;
  }

  const insightText = report.executiveSummary.keyInsights[0] || "Nessun insight disponibile.";

  const cards = [
    {
      kicker: "Top opportunita`",
      value: report.executiveSummary.topOpportunities.join(", ") || "Nessuna",
      body: "Nomi da considerare per capitale nuovo questa settimana."
    },
    {
      kicker: "Nuovi ingressi",
      value: String(report.screening.newEntries || 0),
      body: (report.executiveSummary.newEntries || []).join(", ") || "Nessun nuovo ingresso."
    },
    {
      kicker: "Titoli rimossi",
      value: String(report.screening.removed || 0),
      body: (report.executiveSummary.removed || []).join(", ") || "Nessuna rimozione."
    },
    {
      kicker: "Insight chiave",
      value: report.iterationLabel,
      body: insightText
    }
  ];

  els["summary-grid"].innerHTML = cards
    .map((card) => `
      <article class="summary-card">
        <div class="section-kicker">${escapeHtml(card.kicker)}</div>
        <strong>${escapeHtml(card.value)}</strong>
        <p>${escapeHtml(card.body)}</p>
      </article>
    `)
    .join("");

  els["macro-grid"].innerHTML = (report.macroContext.cards || [])
    .map((card) => `
      <article class="macro-card">
        <div class="section-kicker">${escapeHtml(card.label)}</div>
        <strong class="${toneClass(card.tone)}">${escapeHtml(card.value)}</strong>
        <p>${escapeHtml(card.detail)}</p>
      </article>
    `)
    .join("");

  els["screening-strip"].innerHTML = `
    <strong>Screening aggiornato:</strong>
    ${escapeHtml(report.macroContext.headline)}
    <br>
    <span class="tiny-muted">
      Universo rivisto: ${escapeHtml(String(report.screening.universeReviewed || 0))} titoli ·
      setup validi: ${escapeHtml(String(report.screening.validSetups || 0))} ·
      ${escapeHtml(report.macroContext.screeningNarrative)}
    </span>
  `;
}

function renderWatchlist() {
  const report = getSelectedReport();
  if (!report) {
    return;
  }

  els["watchlist-legend"].innerHTML = [
    buildLegendChip("Nuovo", "status-new"),
    buildLegendChip("Confermato", "status-confirmed"),
    buildLegendChip("In uscita", "status-exit")
  ].join("");

  els["watchlist-body"].innerHTML = report.watchlist
    .map((item) => {
      const selected = item.symbol === state.selectedSymbol ? " class=\"is-selected\"" : "";
      return `
        <tr data-symbol="${escapeHtml(item.symbol)}"${selected}>
          <td>
            <span class="ticker-name">${escapeHtml(item.symbol)} · ${escapeHtml(item.company)}</span>
            <span class="ticker-sub">${escapeHtml(item.priceReference)} · ${escapeHtml(item.catalystWindow)}</span>
          </td>
          <td>
            ${escapeHtml(item.sector)}
            <span class="ticker-sub">${escapeHtml(item.subSector)}</span>
          </td>
          <td>
            ${escapeHtml(item.catalyst)}
            <span class="ticker-sub">${escapeHtml(item.recurringPattern)}</span>
          </td>
          <td>${escapeHtml(item.estimatedUpside)}</td>
          <td>${escapeHtml(item.primaryRisk)}</td>
          <td>${buildStatusChip(item.status)}</td>
        </tr>
      `;
    })
    .join("");

  const removed = report.removed || [];
  els["removed-strip"].innerHTML = removed.length
    ? `<strong>Rimossi questa settimana:</strong> ${removed.map((item) => `${escapeHtml(item.symbol)} (${escapeHtml(item.reason)})`).join(" · ")}`
    : `<strong>Nessun titolo rimosso.</strong> La watchlist mantiene solo i nomi ancora coerenti con il processo.`;
}

function renderDetail() {
  const item = getSelectedItem();
  const report = getSelectedReport();
  if (!item || !report) {
    els["detail-panel"].innerHTML = "<div class=\"message-box\">Nessun ticker selezionato.</div>";
    return;
  }

  els["detail-status"].innerHTML = buildStatusChip(item.status);

  const sourceNotes = (item.sourceNotes || [])
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");
  const history = (item.history || [])
    .map((entry) => `<li>${escapeHtml(entry.weekId)} · ${escapeHtml(entry.price)} · ${escapeHtml(entry.status)} · ${escapeHtml(entry.scenario)}</li>`)
    .join("");
  const riskNotes = (item.riskAnalysis.notes || [])
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");

  const riskValues = [
    { label: "Rischio binario", value: item.riskAnalysis.binaryRisk },
    { label: "Rischio politico", value: item.riskAnalysis.politicalRisk },
    { label: "Rischio diluizione", value: item.riskAnalysis.dilutionRisk },
    { label: "Downside realistico", value: item.riskAnalysis.downside }
  ];

  els["detail-panel"].innerHTML = `
    <div class="detail-hero">
      <article class="detail-box">
        <div class="detail-title-row">
          <div>
            <div class="section-kicker">Investment Thesis</div>
            <h3>${escapeHtml(item.symbol)} · ${escapeHtml(item.company)}</h3>
          </div>
          ${buildStatusChip(item.status)}
        </div>
        <div class="detail-meta">
          <span class="meta-chip">${escapeHtml(item.sector)}</span>
          <span class="meta-chip">${escapeHtml(item.subSector)}</span>
          <span class="meta-chip">Prezzo rif. ${escapeHtml(item.priceReference)}</span>
        </div>
        <p class="detail-copy">${escapeHtml(item.thesis)}</p>
        <div class="section-kicker" style="margin-top:16px;">Aggiornamento vs settimana precedente</div>
        <p class="detail-copy">${escapeHtml(item.updateVsPrevious)}</p>
        <div class="section-kicker" style="margin-top:16px;">Pattern ricorrente</div>
        <p class="detail-copy">${escapeHtml(item.recurringPattern)}</p>
      </article>

      <article class="detail-box">
        <div class="section-kicker">Valuation Gap e market structure</div>
        <div class="detail-split">
          <div>
            <div class="metric-label">Prezzo attuale</div>
            <span class="metric-value">${escapeHtml(item.valuationGap.current)}</span>
          </div>
          <div>
            <div class="metric-label">Target</div>
            <span class="metric-value">${escapeHtml(item.valuationGap.target)}</span>
          </div>
          <div>
            <div class="metric-label">Upside stimato</div>
            <span class="metric-value">${escapeHtml(item.valuationGap.upside)}</span>
          </div>
          <div>
            <div class="metric-label">Trend</div>
            <span class="metric-value">${escapeHtml(item.marketStructure.trend)}</span>
          </div>
        </div>
        <div class="section-kicker" style="margin-top:16px;">Livelli chiave</div>
        <p class="detail-copy">${escapeHtml(item.marketStructure.keyLevels)}</p>
        <div class="section-kicker" style="margin-top:16px;">Posizione nel ciclo</div>
        <p class="detail-copy">${escapeHtml(item.marketStructure.cycle)}</p>
      </article>
    </div>

    <section>
      <div class="section-kicker">Catalyst Timeline</div>
      <div class="timeline-grid">
        <article class="timeline-box">
          <strong>${escapeHtml(item.catalyst)}</strong>
          <small>Finestra: ${escapeHtml(item.catalystWindow)}</small>
          <p class="detail-copy">${escapeHtml(item.estimatedUpside)} · Rischio #1: ${escapeHtml(item.primaryRisk)}</p>
        </article>
        <article class="timeline-box">
          <strong>Storico di tracking</strong>
          <small>Evoluzione scenario</small>
          <ul class="detail-list">${history}</ul>
        </article>
      </div>
    </section>

    <section>
      <div class="section-kicker">Scenario Update</div>
      <div class="scenario-grid">
        ${(item.scenarios || []).map((scenario) => `
          <article class="scenario-card ${scenarioClass(scenario.name)}">
            <strong>${escapeHtml(scenario.name)} · ${escapeHtml(scenario.price)}</strong>
            <small>Probabilita`: ${escapeHtml(scenario.probability)}</small>
            <p class="detail-copy">${escapeHtml(scenario.narrative)}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section>
      <div class="section-kicker">Risk Analysis</div>
      <div class="risk-grid">
        ${riskValues.map((risk) => `
          <article class="risk-box">
            <div class="metric-label">${escapeHtml(risk.label)}</div>
            <span class="metric-value">${escapeHtml(risk.value)}</span>
          </article>
        `).join("")}
      </div>
      <div class="detail-box" style="margin-top:12px;">
        <div class="section-kicker">Note di rischio</div>
        <ul class="detail-list">${riskNotes}</ul>
      </div>
    </section>

    <section>
      <div class="section-kicker">Setup Operativo</div>
      <div class="setup-grid">
        ${setupCard("Entry", item.setup.entry)}
        ${setupCard("Stop", item.setup.stop)}
        ${setupCard("Target", item.setup.target)}
        ${setupCard("Strategia", item.setup.strategy)}
      </div>
    </section>

    <section>
      <div class="section-kicker">Source Notes</div>
      <div class="detail-box">
        <ul class="detail-list">${sourceNotes || "<li>Nessuna nota sorgente disponibile.</li>"}</ul>
      </div>
    </section>
  `;
}

function renderRiskRanking() {
  const report = getSelectedReport();
  if (!report) {
    return;
  }

  const ranking = [
    report.riskRanking.bestRiskReward,
    report.riskRanking.mostDefensive,
    report.riskRanking.mostSpeculative
  ].filter(Boolean);

  els["risk-ranking"].innerHTML = ranking
    .map((item) => `
      <article class="ranking-item">
        <strong>${escapeHtml(item.label)} · ${escapeHtml(item.symbol)}</strong>
        <p>${escapeHtml(item.reason)}</p>
      </article>
    `)
    .join("");
}

function renderPortfolio() {
  const report = getSelectedReport();
  if (!report) {
    return;
  }

  els["portfolio-implication"].innerHTML = (report.portfolioImplication || [])
    .map((item) => `
      <article class="portfolio-item">
        <strong>${escapeHtml(item.bucket)} · ${escapeHtml(item.symbol)}</strong>
        <small>${escapeHtml(item.title)}</small>
        <p>${escapeHtml(item.body)}</p>
      </article>
    `)
    .join("");
}

function renderMethodology() {
  const report = getSelectedReport();
  if (!report) {
    return;
  }

  els["methodology"].innerHTML = (report.methodology.pillars || [])
    .map((pillar) => `
      <article class="method-card">
        <div class="section-kicker">${escapeHtml(pillar.title)}</div>
        <p>${escapeHtml(pillar.body)}</p>
      </article>
    `)
    .join("");
}

function renderWeekDelta() {
  const report = getSelectedReport();
  if (!report) {
    return;
  }

  const previousReport = getPreviousReport(report.id);
  const currentSymbols = new Set((report.watchlist || []).map((item) => item.symbol));
  const previousSymbols = new Set((previousReport?.watchlist || []).map((item) => item.symbol));

  const additions = [...currentSymbols].filter((symbol) => !previousSymbols.has(symbol));
  const carry = [...currentSymbols].filter((symbol) => previousSymbols.has(symbol));
  const removals = (report.removed || []).map((item) => item.symbol);

  const entries = [
    {
      label: "Nuovi titoli",
      body: additions.length ? additions.join(", ") : "Nessun nuovo ticker rispetto alla settimana precedente."
    },
    {
      label: "Titoli mantenuti",
      body: carry.length ? carry.join(", ") : "Nessun nome confermato."
    },
    {
      label: "Titoli rimossi",
      body: removals.length ? removals.join(", ") : "Nessuna rimozione."
    },
    {
      label: "Cambiamento di processo",
      body: report.iterationLabel
    }
  ];

  els["week-delta"].innerHTML = entries
    .map((entry) => `
      <article class="delta-item">
        <strong>${escapeHtml(entry.label)}</strong>
        <p>${escapeHtml(entry.body)}</p>
      </article>
    `)
    .join("");
}

async function refreshQuant(force = false) {
  const item = getSelectedItem();
  if (!item) {
    els["quant-state"].textContent = "Seleziona un ticker per caricare il contesto quant live.";
    els["quant-grid"].innerHTML = "";
    clearCanvas();
    return;
  }

  const cacheKey = `${state.selectedWeekId}:${item.symbol}`;
  if (!force && state.quantCache.has(cacheKey)) {
    renderQuant(state.quantCache.get(cacheKey));
    return;
  }

  setMessage("quant-state", `Carico prezzo e struttura live per ${item.symbol}...`);

  try {
    const response = await fetch(`/api/chart?symbol=${encodeURIComponent(item.symbol)}&range=6mo&interval=1d`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Errore API chart.");
    }
    const quant = computeQuantPayload(item, payload.rows || []);
    state.quantCache.set(cacheKey, quant);
    renderQuant(quant);
  } catch (error) {
    setMessage("quant-state", `Quant live non disponibile: ${error.message || error}`);
    els["quant-grid"].innerHTML = "";
    clearCanvas();
  }
}

function computeQuantPayload(item, rows) {
  const closes = rows.map((row) => Number(row.close)).filter(Number.isFinite);
  const volumes = rows.map((row) => Number(row.volume)).filter(Number.isFinite);
  const last = closes[closes.length - 1];
  const previous20 = closes[Math.max(0, closes.length - 21)];
  const previous5 = closes[Math.max(0, closes.length - 6)];
  const recent20 = closes.slice(-20);
  const recent60 = closes.slice(-60);
  const last5Volumes = mean(volumes.slice(-5));
  const last30Volumes = mean(volumes.slice(-30));
  const atr14 = computeAtr(rows.slice(-20));
  const atr60 = computeAtr(rows.slice(-66));
  const change20d = percentageChange(previous20, last);
  const change5d = percentageChange(previous5, last);
  const volumeRatio = safeDivide(last5Volumes, last30Volumes);
  const squeezeRatio = safeDivide(atr14, atr60);
  const range20 = {
    low: Math.min(...recent20),
    high: Math.max(...recent20)
  };
  const range60 = {
    low: Math.min(...recent60),
    high: Math.max(...recent60)
  };

  return {
    symbol: item.symbol,
    rows,
    lastClose: last,
    change20d,
    change5d,
    volumeRatio,
    squeezeRatio,
    range20,
    range60,
    momentumState: classifyMomentum(change20d),
    volumeState: classifyVolume(volumeRatio),
    volatilityState: classifyVolatility(squeezeRatio)
  };
}

function renderQuant(quant) {
  setMessage(
    "quant-state",
    `${quant.symbol} · ultimo close ${formatMoney(quant.lastClose)} · momentum ${formatSignedPercent(quant.change20d)} su 20 sedute`
  );

  const cards = [
    {
      label: "Momentum 20d",
      value: formatSignedPercent(quant.change20d),
      body: quant.momentumState
    },
    {
      label: "Momentum 5d",
      value: formatSignedPercent(quant.change5d),
      body: "Serve a capire se il move si sta gia` estendendo."
    },
    {
      label: "Volume ratio",
      value: `${round(quant.volumeRatio, 2)}x`,
      body: quant.volumeState
    },
    {
      label: "Volatility regime",
      value: `${round(quant.squeezeRatio, 2)}x`,
      body: quant.volatilityState
    },
    {
      label: "Supporto 20d",
      value: formatMoney(quant.range20.low),
      body: "Zona di controllo del rischio."
    },
    {
      label: "Resistenza 20d",
      value: formatMoney(quant.range20.high),
      body: "Livello di breakout o presa profitto."
    }
  ];

  els["quant-grid"].innerHTML = cards
    .map((card) => `
      <article class="quant-card">
        <div class="section-kicker">${escapeHtml(card.label)}</div>
        <strong>${escapeHtml(card.value)}</strong>
        <p>${escapeHtml(card.body)}</p>
      </article>
    `)
    .join("");

  drawLineChart(els["price-canvas"], quant.rows);
}

async function refreshIntel(force = false) {
  const item = getSelectedItem();
  if (!item) {
    setMessage("intel-state", "Seleziona un ticker per interrogare le fonti esterne.");
    els["intel-summary"].innerHTML = "";
    els["intel-feeds"].innerHTML = "";
    return;
  }

  const cacheKey = `${state.selectedWeekId}:${item.symbol}`;
  if (!force && state.intelCache.has(cacheKey)) {
    renderIntel(state.intelCache.get(cacheKey));
    return;
  }

  setMessage("intel-state", `Interrogo Yahoo, Reddit e fonte regolatoria per ${item.symbol}...`);

  const params = new URLSearchParams({
    symbol: item.symbol,
    company: item.sourceFocus.company,
    sector: item.sourceFocus.sector,
    keywords: (item.sourceFocus.keywords || []).join(",")
  });

  try {
    const response = await fetch(`/api/intel?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      if (payload && payload.fallback) {
        state.intelCache.set(cacheKey, payload.fallback);
        renderIntel(payload.fallback);
        return;
      }
      throw new Error(payload.error || "Errore API intel.");
    }
    state.intelCache.set(cacheKey, payload);
    renderIntel(payload);
  } catch (error) {
    setMessage("intel-state", `Fonti live non disponibili: ${error.message || error}`);
    els["intel-summary"].innerHTML = "";
    els["intel-feeds"].innerHTML = "";
  }
}

function renderIntel(payload) {
  setMessage(
    "intel-state",
    `Ultimo aggiornamento ${formatDateTime(payload.fetchedAt)} · provider: ${payload.providers?.join(", ") || "multi-source"}`
  );

  els["intel-summary"].innerHTML = `
    <strong>Read-through live:</strong>
    ${escapeHtml((payload.summary || []).join(" "))}
  `;

  const sections = [
    { label: "News / contesto", items: payload.feeds?.news || [] },
    { label: "Forum / Reddit", items: payload.feeds?.reddit || [] },
    { label: "Fonte regolatoria", items: payload.feeds?.regulatory || [] },
    { label: "Filing", items: payload.feeds?.filings || [] }
  ];

  els["intel-feeds"].innerHTML = sections
    .map((section) => `
      <article class="feed-block">
        <div class="source-label">${escapeHtml(section.label)}</div>
        <h3>${escapeHtml(section.items.length ? `${section.items.length} evidenze` : "Nessuna evidenza")}</h3>
        <div class="intel-feeds">
          ${section.items.length
            ? section.items.map((item) => `
                <div class="feed-item">
                  <strong><a href="${escapeAttribute(item.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(item.title || item.name || "Voce")}</a></strong>
                  <small>${escapeHtml(buildFeedMeta(item))}</small>
                  <p>${escapeHtml(item.summary || item.snippet || item.detail || "Nessun riassunto disponibile.")}</p>
                </div>
              `).join("")
            : `<div class="feed-item"><p>Nessuna evidenza disponibile per questa fonte.</p></div>`}
        </div>
      </article>
    `)
    .join("");
}

function seedChat() {
  state.chatMessages = [];
  const item = getSelectedItem();
  const report = getSelectedReport();
  const defaultMessage = item
    ? `Ticker attivo: ${item.symbol}. Puoi chiedere thesis, rischi, differenze vs settimana precedente, setup operativo o fonti esterne.`
    : `Report ${report?.weekLabel || ""} caricato.`;

  appendChatMessage("assistant", defaultMessage, true);
  renderChatSuggestions();
}

function renderChatSuggestions() {
  const item = getSelectedItem();
  const report = getSelectedReport();
  const bestSymbol = report?.riskRanking?.bestRiskReward?.symbol || item?.symbol || "";
  const suggestions = [
    `Perche ${item?.symbol || "questo titolo"} e\` nel report questa settimana?`,
    `Cosa e\` cambiato vs settimana precedente per ${item?.symbol || "il ticker selezionato"}?`,
    `Qual e\` il rischio principale di ${item?.symbol || "questo ticker"}?`,
    `Perche ${bestSymbol} ha il miglior rischio/rendimento?`
  ];

  els["chat-suggestions"].innerHTML = suggestions
    .map((question) => `<button class="suggestion-button" type="button" data-question="${escapeAttribute(question)}">${escapeHtml(question)}</button>`)
    .join("");
}

function appendChatMessage(role, content, reset = false) {
  if (reset) {
    state.chatMessages = [];
  }
  state.chatMessages.push({ role, content });
  renderChatMessages();
}

function replaceLastAssistantMessage(content) {
  for (let index = state.chatMessages.length - 1; index >= 0; index -= 1) {
    if (state.chatMessages[index].role === "assistant") {
      state.chatMessages[index] = { role: "assistant", content };
      break;
    }
  }
  renderChatMessages();
}

function renderChatMessages() {
  els["chat-messages"].innerHTML = state.chatMessages
    .map((message) => `
      <article class="chat-bubble ${message.role === "user" ? "is-user" : "is-assistant"}">
        <div class="chat-author">${message.role === "user" ? "Tu" : "Desk chat"}</div>
        <p>${formatChatContent(message.content)}</p>
      </article>
    `)
    .join("");
  els["chat-messages"].scrollTop = els["chat-messages"].scrollHeight;
}

async function askChat(question) {
  const item = getSelectedItem();
  const cacheKey = `${state.selectedWeekId}:${item?.symbol || ""}`;
  const intel = state.intelCache.get(cacheKey);

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      weekId: state.selectedWeekId,
      symbol: item?.symbol || "",
      question,
      intel
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Errore chat.");
  }
  return payload;
}

function getSelectedReport() {
  return state.reports.find((report) => report.id === state.selectedWeekId) || state.reports[0];
}

function getPreviousReport(weekId) {
  const index = state.reports.findIndex((report) => report.id === weekId);
  if (index <= 0) {
    return null;
  }
  return state.reports[index - 1];
}

function getSelectedItem() {
  const report = getSelectedReport();
  return report?.watchlist?.find((item) => item.symbol === state.selectedSymbol) || report?.watchlist?.[0] || null;
}

function buildLegendChip(label, className) {
  return `<span class="legend-chip ${className}">${escapeHtml(label)}</span>`;
}

function buildStatusChip(status) {
  const map = {
    "Nuovo": "status-new",
    "Confermato": "status-confirmed",
    "In uscita": "status-exit",
    "Attesa": "status-watch"
  };
  return `<span class="status-chip ${map[status] || "status-watch"}">${escapeHtml(status)}</span>`;
}

function setupCard(label, value) {
  return `
    <article class="setup-card">
      <div class="metric-label">${escapeHtml(label)}</div>
      <span class="metric-value">${escapeHtml(value)}</span>
    </article>
  `;
}

function scenarioClass(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized.includes("bull")) {
    return "scenario-bull";
  }
  if (normalized.includes("bear")) {
    return "scenario-bear";
  }
  return "scenario-base";
}

function toneClass(tone) {
  if (tone === "positive") {
    return "positive";
  }
  if (tone === "negative") {
    return "negative";
  }
  return "neutral";
}

function setMessage(id, text) {
  els[id].textContent = text;
}

function buildFeedMeta(item) {
  return [
    item.provider,
    item.subreddit ? `r/${item.subreddit}` : "",
    item.publishedAtLabel || item.filingDate || item.phase || "",
    Number.isFinite(item.score) ? `score ${item.score}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

function computeAtr(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return 0;
  }
  const ranges = [];
  for (let index = 1; index < rows.length; index += 1) {
    const current = rows[index];
    const previous = rows[index - 1];
    const high = Number(current.high);
    const low = Number(current.low);
    const prevClose = Number(previous.close);
    if (![high, low, prevClose].every(Number.isFinite)) {
      continue;
    }
    ranges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return mean(ranges);
}

function classifyMomentum(change20d) {
  if (!Number.isFinite(change20d)) {
    return "Momentum non disponibile.";
  }
  if (change20d > 0.28) {
    return "Momentum troppo esteso per nuova size piena.";
  }
  if (change20d > 0.08) {
    return "Momentum iniziale coerente con il filtro del desk.";
  }
  if (change20d > -0.05) {
    return "Fase neutrale: serve catalyst o volume expansion.";
  }
  return "Momentum debole: setup ancora prematuro.";
}

function classifyVolume(volumeRatio) {
  if (!Number.isFinite(volumeRatio)) {
    return "Volume non disponibile.";
  }
  if (volumeRatio >= 1.7) {
    return "Volume expansion forte: il mercato sta gia` reagendo.";
  }
  if (volumeRatio >= 1.1) {
    return "Volume in miglioramento: buono per conferma, non ancora climax.";
  }
  return "Volume piatto o in contrazione: meglio attendere trigger.";
}

function classifyVolatility(squeezeRatio) {
  if (!Number.isFinite(squeezeRatio)) {
    return "Volatilita` non disponibile.";
  }
  if (squeezeRatio <= 0.85) {
    return "Compressione: nome interessante se il catalyst si avvicina.";
  }
  if (squeezeRatio <= 1.15) {
    return "Regime neutrale: la volatilita` non sta ancora anticipando il move.";
  }
  return "Espansione gia` partita: il rischio di inseguire cresce.";
}

function percentageChange(previous, current) {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) {
    return 0;
  }
  return current / previous - 1;
}

function drawLineChart(canvas, rows) {
  if (!canvas || !rows.length) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(Math.floor(canvas.clientWidth * dpr), 320);
  const height = Math.max(Math.floor(canvas.clientHeight * dpr), 200);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  const padding = { top: 18, right: 18, bottom: 22, left: 18 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const visibleRows = rows.slice(-90);
  const closes = visibleRows.map((row) => Number(row.close)).filter(Number.isFinite);
  if (!closes.length) {
    return;
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const yFor = (value) => padding.top + (1 - safeDivide(value - min, Math.max(max - min, 0.0001))) * chartHeight;
  const xFor = (index) => padding.left + safeDivide(index, Math.max(visibleRows.length - 1, 1)) * chartWidth;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + (chartHeight / 4) * step;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }
  ctx.restore();

  const rising = closes[closes.length - 1] >= closes[0];
  const stroke = rising ? "#5bc18f" : "#f06a7f";

  ctx.save();
  ctx.beginPath();
  visibleRows.forEach((row, index) => {
    const x = xFor(index);
    const y = yFor(Number(row.close));
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.lineWidth = 3;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
  gradient.addColorStop(0, rising ? "rgba(91,193,143,0.24)" : "rgba(240,106,127,0.24)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.lineTo(xFor(visibleRows.length - 1), padding.top + chartHeight);
  ctx.lineTo(padding.left, padding.top + chartHeight);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#edf4f8";
  ctx.font = `${11 * dpr}px IBM Plex Mono`;
  ctx.fillText(formatMoney(closes[closes.length - 1]), padding.left, padding.top + 8);
  ctx.restore();
}

function clearCanvas() {
  const canvas = els["price-canvas"];
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) {
    return 0;
  }
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function safeDivide(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) {
    return "N/D";
  }
  return `$${round(value, 2).toFixed(2)}`;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) {
    return "N/D";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${round(value * 100, 1)}%`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("it-IT", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "N/D";
  }
  return date.toLocaleString("it-IT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatChatContent(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
