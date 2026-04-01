# Defense & Biotech Weekly Catalyst Desk

Desk HTML pronto per Vercel che unifica i due bot legacy in un solo processo settimanale comparabile.

## Obiettivo

Il progetto serve a produrre ogni settimana un report operativo focalizzato su small cap:

- difesa
- biotech
- prezzo tra `1$` e `10$`
- catalyst attesi nei prossimi `15-60 giorni`
- possibile valuation gap / mispricing

Il desk non forza opportunita`: se il filtro non passa, il report lo dichiara apertamente.

## Architettura

- [`index.html`](/Users/nicotrc/Documents/New project/index.html): shell HTML del report
- [`styles.css`](/Users/nicotrc/Documents/New project/styles.css): UI istituzionale, responsive, pronta per Vercel
- [`app.js`](/Users/nicotrc/Documents/New project/app.js): rendering del report, tracking week-over-week, quant live e chat
- [`data/weekly-reports.json`](/Users/nicotrc/Documents/New project/data/weekly-reports.json): dataset storico settimanale
- [`api/chart.js`](/Users/nicotrc/Documents/New project/api/chart.js): bridge Yahoo Finance OHLCV
- [`api/news.js`](/Users/nicotrc/Documents/New project/api/news.js): bridge Yahoo Finance news
- [`api/intel.js`](/Users/nicotrc/Documents/New project/api/intel.js): aggregatore multi-source
- [`api/chat.js`](/Users/nicotrc/Documents/New project/api/chat.js): chat contestuale sul report
- [`api/_lib`](/Users/nicotrc/Documents/New project/api/_lib/http.js): helper modulari per fetch, SEC, Reddit, ClinicalTrials e Yahoo

## Fonti integrate

Il desk incrocia:

- Yahoo Finance per news e prezzo
- Reddit per sentiment retail / forum
- SEC EDGAR per filing societari
- ClinicalTrials.gov per i nomi biotech

Se una fonte esterna fallisce, il frontend continua a funzionare usando il dataset locale. Per test offline puoi attivare il fallback mock.

## Deploy Vercel

Non serve build step.

1. Pubblica la cartella su Vercel.
2. Mantieni il rewrite della root verso `index.html`.
3. Opzionale ma consigliato: imposta una `APP_USER_AGENT` reale per chiamate SEC.

## Variabili ambiente opzionali

- `APP_USER_AGENT`
  Esempio: `CatalystDesk/1.0 (tuamail@dominio.com)`
- `MOCK_INTEL=1`
  Forza il backend a restituire fonti mock utili per test UI/offline

## Workflow settimanale

1. Aggiorna [`data/weekly-reports.json`](/Users/nicotrc/Documents/New project/data/weekly-reports.json) con la nuova settimana.
2. Mantieni gli stessi campi: summary, watchlist, removed, ranking, portfolio implication.
3. Tieni i ticker rimossi almeno una settimana nel tracking se serve spiegare la migrazione di scenario.
4. Verifica sempre:
   - overfitting risk
   - look-ahead bias
   - transaction costs
   - dilution risk
   - coerenza del catalyst rispetto al settore

## Chat live

La chat usa il report selezionato come base e, se disponibili, le evidenze live da `api/intel`.

Domande supportate:

- thesis / perche` il titolo e` nel report
- cosa e` cambiato vs settimana precedente
- rischi principali
- setup operativo
- ranking rischio/rendimento
- fonti esterne

## Nota operativa

Il dataset incluso e` una baseline di migrazione costruita a partire dai due bot legacy forniti. Per uso reale va aggiornato ogni settimana con verifica manuale di prezzi, date catalyst, filing e liquidita`.
