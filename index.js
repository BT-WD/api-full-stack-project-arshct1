'use strict';

const API = '/api';

// Lightweight company name map — avoids extra API calls for labels in suggestions/watchlist
const NAMES = {
  AAPL:'Apple', MSFT:'Microsoft', GOOGL:'Alphabet', GOOG:'Alphabet',
  AMZN:'Amazon', META:'Meta', TSLA:'Tesla', NVDA:'Nvidia',
  NFLX:'Netflix', AMD:'AMD', INTC:'Intel', ORCL:'Oracle',
  CRM:'Salesforce', ADBE:'Adobe', PYPL:'PayPal', UBER:'Uber',
  LYFT:'Lyft', SNAP:'Snap', SPOT:'Spotify', SHOP:'Shopify',
  ZM:'Zoom', PLTR:'Palantir', GME:'GameStop', AMC:'AMC',
  BABA:'Alibaba', NIO:'NIO', JPM:'JPMorgan', BAC:'Bank of America',
  GS:'Goldman Sachs', MS:'Morgan Stanley', WMT:'Walmart',
  DIS:'Disney', BA:'Boeing', GE:'GE', F:'Ford', GM:'GM',
  T:'AT&T', VZ:'Verizon', COIN:'Coinbase', RBLX:'Roblox',
  SPY:'S&P 500 ETF', QQQ:'Nasdaq ETF', IWM:'Russell 2000 ETF', SQ:'Block',
};

// ============================================================
// GLOBAL STATE
// ============================================================
const state = {
  currentTicker: null,
  watchlistTickers: [],   // array of ticker strings for quick lookup
};

// ============================================================
// DOM REFS
// ============================================================
const $  = id => document.getElementById(id);
const searchInput    = $('searchInput');
const searchBtn      = $('searchBtn');
const landingState   = $('landingState');
const stockContent   = $('stockContent');
const newsLoader     = $('newsLoader');
const stockTicker    = $('stockTicker');
const stockExchange  = $('stockExchange');
const stockCompany   = $('stockCompany');
const stockPrice     = $('stockPrice');
const stockChange    = $('stockChange');
const stockChangePct = $('stockChangePct');
const stockVolume    = $('stockVolume');
const stockCurrency  = $('stockCurrency');
const newsArticles   = $('newsArticles');
const newsCount      = $('newsCount');
const watchlistItems = $('watchlistItems');
const addWatchlistBtn = $('addWatchlistBtn');
const sparklineCanvas = $('sparklineCanvas');
const sparkHigh      = $('sparkHigh');
const sparkLow       = $('sparkLow');
const suggestionsPanel = $('suggestionsPanel');

// ============================================================
// FETCH HELPER
// ============================================================
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

// ============================================================
// SEARCH WIRING
// ============================================================
searchBtn.addEventListener('click', () => doSearch());
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

// Landing hint chips trigger search directly
document.getElementById('landingHints').addEventListener('click', e => {
  if (e.target.tagName === 'SPAN') {
    searchInput.value = e.target.textContent;
    doSearch();
  }
});

function doSearch() {
  const ticker = searchInput.value.trim().toUpperCase().replace(/[^A-Z.]/g, '');
  if (!ticker) return;
  searchInput.value = ticker;
  loadTicker(ticker);
}

// ============================================================
// MAIN LOAD ORCHESTRATOR
// ============================================================
async function loadTicker(ticker) {
  state.currentTicker = ticker;

  // Show skeleton, hide landing
  landingState.classList.add('hidden');
  stockContent.classList.remove('hidden');
  newsLoader.classList.remove('hidden');
  newsArticles.innerHTML = '';
  newsCount.textContent  = '';

  // Reset header to loading placeholders
  stockTicker.textContent    = ticker;
  stockExchange.textContent  = '—';
  stockCompany.textContent   = 'Loading…';
  stockPrice.textContent     = '—';
  stockChange.textContent    = '—';
  stockChangePct.textContent = '—';
  stockVolume.textContent    = '—';
  stockChange.className      = 'stock-change';
  stockChangePct.className   = 'stock-change-pct';

  // Fetch stock quote and news in parallel
  const [stockResult, newsResult] = await Promise.allSettled([
    fetchJSON(`${API}/stock/${ticker}`),
    fetchJSON(`${API}/news/${ticker}`),
  ]);

  // Render stock header
  if (stockResult.status === 'fulfilled') {
    renderHeader(stockResult.value);
  } else {
    stockCompany.textContent = 'Could not load quote data';
    console.error('Stock fetch:', stockResult.reason);
  }

  // Render news
  if (newsResult.status === 'fulfilled') {
    const { articles } = newsResult.value;
    renderNews(articles);
    newsCount.textContent = `${articles.length} article${articles.length !== 1 ? 's' : ''} ranked`;
  } else {
    newsArticles.innerHTML = '<div class="empty-state">Failed to load news</div>';
    newsCount.textContent  = 'error';
    console.error('News fetch:', newsResult.reason);
  }

  newsLoader.classList.add('hidden');

  // Refresh watchlist button state whenever we load a new ticker
  updateWatchlistBtn();
}

// ============================================================
// STOCK HEADER RENDERER
// ============================================================
function renderHeader(d) {
  stockTicker.textContent   = d.ticker;
  stockExchange.textContent = d.exchange || '';
  stockCompany.textContent  = d.company_name || d.ticker;
  stockCurrency.textContent = d.currency || 'USD';

  const price    = d.price     ?? 0;
  const change   = d.change    ?? 0;
  const changePct = d.change_pct ?? 0;
  const isPos    = change >= 0;
  const sign     = isPos ? '+' : '';

  stockPrice.textContent     = `$${price.toFixed(2)}`;
  stockChange.textContent    = `${sign}${change.toFixed(2)}`;
  stockChangePct.textContent = `${sign}${changePct.toFixed(2)}%`;

  stockChange.className    = `stock-change    ${isPos ? 'positive' : 'negative'}`;
  stockChangePct.className = `stock-change-pct ${isPos ? 'positive' : 'negative'}`;

  stockVolume.textContent = fmtVol(d.volume);

  if (d.ohlc && d.ohlc.length >= 2) drawSparkline(d.ohlc, isPos);
}

// ============================================================
// SPARKLINE — drawn on a <canvas> element
// ============================================================
function drawSparkline(ohlc, isPositive) {
  const ctx = sparklineCanvas.getContext('2d');
  const W = sparklineCanvas.width;
  const H = sparklineCanvas.height;
  const pad = { t: 10, b: 10, l: 6, r: 6 };

  ctx.clearRect(0, 0, W, H);

  const closes = ohlc.map(d => d.close).filter(v => v != null);
  if (closes.length < 2) return;

  const minV = Math.min(...closes);
  const maxV = Math.max(...closes);
  const range = maxV - minV || 1;

  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const xAt = i => pad.l + (i / (closes.length - 1)) * plotW;
  const yAt = v => pad.t + (1 - (v - minV) / range) * plotH;

  const color = isPositive ? '#00d4aa' : '#ff4444';

  // Fill area under line
  const grad = ctx.createLinearGradient(0, pad.t, 0, H);
  grad.addColorStop(0, isPositive ? 'rgba(0,212,170,.22)' : 'rgba(255,68,68,.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(closes[0]));
  for (let i = 1; i < closes.length; i++) ctx.lineTo(xAt(i), yAt(closes[i]));
  ctx.lineTo(xAt(closes.length - 1), H);
  ctx.lineTo(xAt(0), H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line stroke
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(closes[0]));
  for (let i = 1; i < closes.length; i++) ctx.lineTo(xAt(i), yAt(closes[i]));
  ctx.strokeStyle  = color;
  ctx.lineWidth    = 1.5;
  ctx.lineJoin     = 'round';
  ctx.lineCap      = 'round';
  ctx.stroke();

  // Terminal dot
  const lx = xAt(closes.length - 1);
  const ly = yAt(closes[closes.length - 1]);
  ctx.beginPath();
  ctx.arc(lx, ly, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // High / Low labels
  sparkHigh.textContent = `H $${maxV.toFixed(2)}`;
  sparkLow.textContent  = `L $${minV.toFixed(2)}`;
}

// ============================================================
// NEWS RENDERER
// ============================================================
function renderNews(articles) {
  if (!articles || articles.length === 0) {
    newsArticles.innerHTML = '<div class="empty-state">No articles found for this ticker</div>';
    return;
  }

  newsArticles.innerHTML = articles.map((art, i) => buildCard(art, i + 1)).join('');

  // Clicking any part of the card opens the article in a new tab
  newsArticles.querySelectorAll('.article-card').forEach((card, i) => {
    card.addEventListener('click', e => {
      // Don't double-fire if user clicked the <a> directly
      if (e.target.tagName === 'A' || e.target.closest('a')) return;
      const url = articles[i]?.url;
      if (url && url !== '#') window.open(url, '_blank', 'noopener');
    });
  });
}

function buildCard(art, rank) {
  const isTop3      = rank <= 3;
  const score       = art.total_score ?? 0;
  const scoreClass  = score >= 65 ? 'score-high' : score >= 40 ? 'score-mid' : 'score-low';
  const sentClass   = art.sentiment_label === 'BULLISH' ? 'pill-bullish'
                    : art.sentiment_label === 'BEARISH' ? 'pill-bearish'
                    : 'pill-neutral';

  const bd = art.breakdown ?? {};
  const bdHTML = Object.entries(bd).map(([k, v]) => {
    if (!v) return '';
    const label = k.replace(/_/g, ' '); // non-breaking space
    return `<span class="bd-item"><span>${label}:</span> ${v.score}/${v.max}</span>`;
  }).join('');

  // Use the recency detail (e.g. "2.3h ago") as the time display if available
  const timeStr = bd.recency?.detail && /ago/.test(bd.recency.detail)
    ? bd.recency.detail
    : fmtDate(art.published_at);

  return `
<div class="article-card">
  <div class="article-rank${isTop3 ? ' top3' : ''}">${rank}</div>
  <div class="article-body">
    <div class="article-top">
      <a class="article-headline"
         href="${escAttr(art.url)}"
         target="_blank"
         rel="noopener noreferrer">${escHTML(art.title)}</a>
      <span class="score-badge ${scoreClass}">${Math.round(score)}</span>
    </div>
    <div class="article-meta">
      <span class="article-source">${escHTML(art.source)}</span>
      <span class="article-dot">●</span>
      <span class="article-time">${timeStr}</span>
      <span class="article-dot">●</span>
      <span class="sentiment-pill ${sentClass}">${art.sentiment_label ?? 'NEUTRAL'}</span>
    </div>
    <div class="article-reasoning">${escHTML(art.one_line_reasoning ?? '')}</div>
    <div class="article-breakdown">${bdHTML}</div>
  </div>
</div>`;
}

// ============================================================
// WATCHLIST
// ============================================================
async function loadWatchlist() {
  try {
    const data = await fetchJSON(`${API}/watchlist`);
    state.watchlistTickers = data.watchlist.map(w => w.ticker);
    await renderWatchlist(data.watchlist);
  } catch (e) {
    console.error('Watchlist load:', e);
  }
  updateWatchlistBtn();
}

async function renderWatchlist(items) {
  if (!items || items.length === 0) {
    watchlistItems.innerHTML = '<div class="empty-state">No tickers saved</div>';
    return;
  }

  // Fetch live quotes for each saved ticker in parallel
  const rows = await Promise.all(
    items.map(async ({ ticker }) => {
      try {
        const d = await fetchJSON(`${API}/stock/${ticker}`);
        return { ticker, price: d.price, changePct: d.change_pct, company: d.company_name };
      } catch {
        return { ticker, price: null, changePct: null, company: NAMES[ticker] ?? '' };
      }
    })
  );

  watchlistItems.innerHTML = rows.map(r => {
    const priceStr  = r.price    != null ? `$${r.price.toFixed(2)}`                       : '—';
    const pctStr    = r.changePct != null ? `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(2)}%` : '—';
    const cls       = (r.changePct ?? 0) >= 0 ? 'positive' : 'negative';
    return `
<div class="watchlist-ticker-item" data-ticker="${r.ticker}">
  <div class="wl-left">
    <span class="wl-ticker">${r.ticker}</span>
    <span class="wl-company">${escHTML(r.company)}</span>
  </div>
  <div class="wl-right">
    <span class="wl-price">${priceStr}</span>
    <span class="wl-change ${cls}">${pctStr}</span>
  </div>
</div>`;
  }).join('');

  watchlistItems.querySelectorAll('.watchlist-ticker-item').forEach(el => {
    el.addEventListener('click', () => {
      searchInput.value = el.dataset.ticker;
      loadTicker(el.dataset.ticker);
    });
  });
}

// Add-to-watchlist button in the stock header
addWatchlistBtn.addEventListener('click', async () => {
  if (!state.currentTicker) return;
  try {
    await fetch(`${API}/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: state.currentTicker }),
    });
    await loadWatchlist();
  } catch (e) {
    console.error('Add watchlist:', e);
  }
});

function updateWatchlistBtn() {
  const saved = state.watchlistTickers.includes(state.currentTicker);
  addWatchlistBtn.textContent = saved ? '✓ SAVED' : '+ WATCHLIST';
  addWatchlistBtn.className = 'add-watchlist-btn' + (saved ? ' saved' : '');
}

// ============================================================
// SUGGESTIONS
// ============================================================
async function loadSuggestions() {
  try {
    const data = await fetchJSON(`${API}/suggestions`);
    suggestionsPanel.innerHTML = data.suggestions.map(ticker => `
<div class="suggestion-item" data-ticker="${ticker}">
  <div class="sug-left">
    <span class="sug-ticker">${ticker}</span>
    <span class="sug-company">${escHTML(NAMES[ticker] ?? '')}</span>
  </div>
  <span class="sug-trend">TRENDING</span>
</div>`).join('');

    suggestionsPanel.querySelectorAll('.suggestion-item').forEach(el => {
      el.addEventListener('click', () => {
        searchInput.value = el.dataset.ticker;
        loadTicker(el.dataset.ticker);
      });
    });
  } catch (e) {
    suggestionsPanel.innerHTML = '<div class="loading-text">Unavailable</div>';
  }
}

// ============================================================
// UTILITIES
// ============================================================

function fmtVol(vol) {
  if (vol == null) return '—';
  if (vol >= 1e9) return (vol / 1e9).toFixed(2) + 'B';
  if (vol >= 1e6) return (vol / 1e6).toFixed(2) + 'M';
  if (vol >= 1e3) return (vol / 1e3).toFixed(1) + 'K';
  return String(vol);
}

function fmtDate(str) {
  if (!str) return '—';
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    const diffH = (Date.now() - d.getTime()) / 3_600_000;
    if (diffH < 0)  return 'just now';
    if (diffH < 1)  return `${Math.round(diffH * 60)}m ago`;
    if (diffH < 24) return `${diffH.toFixed(1)}h ago`;
    return `${(diffH / 24).toFixed(1)}d ago`;
  } catch {
    return str;
  }
}

function escHTML(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  if (!s) return '#';
  return String(s).replace(/"/g, '&quot;');
}

// ============================================================
// INIT
// ============================================================
loadWatchlist();
loadSuggestions();
