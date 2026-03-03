// Constants
const TIME_PERIODS = ['total', 'inPastYear', 'inPastMonth'];
const SORT_KEYS = ['relevant', 'newest'];
const SORT_LABELS = { relevant: 'Relevant', newest: 'Newest' };
const PAGE_SIZE = 20;
const MIN_PAGES_BEFORE_STABILIZE = 2;
// GEMINI_API_KEY loaded from config.js
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
let loggedSampleReview = false;

// State
let currentOption = 'total';
let lastPlaceName = '';
let lastUrl = '';
let abortControllers = { relevant: null, newest: null };
const getSummaryCacheKey = () => `rc_summary_${lastPlaceName || 'default'}`;
let summaryCache = { all: null, filtered: null };
let reviewLimit = 50;
const loadSummaryCache = () => {
  try { summaryCache = JSON.parse(localStorage.getItem(getSummaryCacheKey())) || { all: null, filtered: null }; }
  catch { summaryCache = { all: null, filtered: null }; }
};
const saveSummaryCache = () => { try { localStorage.setItem(getSummaryCacheKey(), JSON.stringify(summaryCache)); } catch {} };

const makeReviewData = () => ({
  reviewsScores: Object.fromEntries(TIME_PERIODS.map((p) => [p, 0])),
  trustedReviews: Object.fromEntries(TIME_PERIODS.map((p) => [p, 0])),
  totalReviews: Object.fromEntries(TIME_PERIODS.map((p) => [p, 0])),
});

const makeState = () => ({ reviewMap: {}, reviewData: makeReviewData(), isFetching: false, done: false, cursor: '', pageCount: 0 });

const scores = { relevant: makeState(), newest: makeState() };

// Helpers
const getReviewCount = (sortKey) => Object.keys(scores[sortKey].reviewMap).length;
const getRoundedPct = (sortKey) => Math.round(getScorePercentage(sortKey) * 100);
const getTrendIcon = (diff) => diff > 1 ? '↗' : diff < -1 ? '↘' : '→';

const resetScores = () => {
  for (const key of SORT_KEYS) {
    scores[key] = makeState();
    if (abortControllers[key]) { abortControllers[key].abort(); abortControllers[key] = null; }
  }
};

const getScoreColor = (pct) => {
  const stops = [
    { at: 0, r: 248, g: 113, b: 113 },
    { at: 0.5, r: 251, g: 191, b: 36 },
    { at: 1, r: 74, g: 222, b: 128 },
  ];
  const p = Math.max(0, Math.min(1, pct));
  const i = stops.findIndex((s) => p <= s.at);
  const lo = stops[Math.max(0, i - 1)];
  const hi = stops[Math.min(stops.length - 1, i)];
  const t = hi.at === lo.at ? 0 : (p - lo.at) / (hi.at - lo.at);
  return `rgb(${Math.round(lo.r + (hi.r - lo.r) * t)},${Math.round(lo.g + (hi.g - lo.g) * t)},${Math.round(lo.b + (hi.b - lo.b) * t)})`;
};

const calculateFullPercentage = () => {
  const reviewRows = document.querySelectorAll('tr[role="img"]');
  if (reviewRows.length < 5) return null;
  const extractNumber = (str) => {
    const match = str.match(/(\d+(?:[.,]\d+)*)\s*(?:reviews?|$)/);
    return match ? parseInt(match[1].replace(/[.,]/g, ''), 10) : 0;
  };
  const counts = Array.from(reviewRows).map((r) => extractNumber(r.getAttribute('aria-label')));
  const allReviews = counts.reduce((a, b) => a + b, 0);
  if (!allReviews) return null;
  return Math.round(((counts[0] - counts[4]) / allReviews) * 100);
};

// URL & API
const getFeatureId = () => {
  // Current place is always in the !3m5!1s section (last one in URL)
  const matches = [...location.href.matchAll(/!3m\d+!1s(0x[a-f0-9]+(?:%3A|:)0x[a-f0-9]+)/gi)];
  return matches.length ? decodeURIComponent(matches[matches.length - 1][1]) : null;
};

const buildUrl = (featureId, sort, cursor = '') => {
  const hl = document.documentElement.lang || 'en';
  const gl = location.href.match(/gl=([a-zA-Z]{2})/)?.[1] || '';
  const sortVal = sort === 'newest' ? 2 : 1;
  const pb = [
    `!1m6!1s${featureId}!6m4!4m1!1e1!4m1!1e3`,
    `!2m2!1i${PAGE_SIZE}!2s${encodeURIComponent(cursor)}`,
    `!5m2!1s!7e81`,
    `!8m9!2b1!3b1!5b1!7b1!12m4!1b1!2b1!4m1!1e1`,
    `!11m4!1e3!2e1!6m1!1i2`,
    `!13m1!1e${sortVal}`,
  ].join('');
  return `https://www.google.com/maps/rpc/listugcposts?authuser=0&hl=${hl}&gl=${gl}&pb=${pb}`;
};

// Find the longest non-URL string in a review structure (review text)
const findReviewText = (obj, depth = 0) => {
  if (depth > 6) return '';
  if (typeof obj === 'string' && obj.length > 20 && !obj.startsWith('http') && !obj.startsWith('0x')) return obj;
  if (Array.isArray(obj)) {
    let best = '';
    for (const item of obj) {
      const found = findReviewText(item, depth + 1);
      if (found.length > best.length) best = found;
    }
    return best;
  }
  return '';
};

// Response parsing — data[2][i][0] = [id, details, ratings]
const parseReviewsResponse = (text) => {
  try {
    const cleaned = text.replace(/^\)\]\}'/, '');
    const data = JSON.parse(cleaned);
    const arr = data[2];
    if (!arr?.length) return { reviews: [], nextCursor: null };
    const reviews = [];
    for (const wrapper of arr) {
      if (!wrapper?.[0]) continue;
      const r = wrapper[0];
      const reviewId = r[0];
      const stars = r[2]?.[0]?.[0];
      const reviewerReviewCount = r[1]?.[4]?.[5]?.[5] || 1;
      const timestamp = r[1]?.[2];
      if (!loggedSampleReview) {
        for (let i = 0; i < Math.min(r.length, 20); i++) {
          const v = r[i];
          const preview = v == null ? 'null' : typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v)?.slice(0, 300);
          console.log(`[Reviews] r[${i}] (${typeof v}):`, preview);
        }
        loggedSampleReview = true;
      }
      const text = findReviewText(r);
      if (reviewId && stars) reviews.push({ reviewId, stars, reviewerReviewCount, timestamp, text });
    }
    return { reviews, nextCursor: data[1] || null };
  } catch (e) {
    console.error('[Reviews] Parse error:', e);
    return { reviews: [], nextCursor: null };
  }
};

const classifyTimePeriod = (timestamp) => {
  if (!timestamp) return { inPastYear: false, inPastMonth: false };
  const d = new Date(timestamp / 1000);
  const now = new Date();
  const yearAgo = new Date(now); yearAgo.setFullYear(now.getFullYear() - 1);
  const monthAgo = new Date(now); monthAgo.setMonth(now.getMonth() - 1);
  return { inPastYear: d >= yearAgo, inPastMonth: d >= monthAgo };
};

const processReview = (review, sortKey) => {
  const rd = scores[sortKey].reviewData;
  const isTrusted = review.reviewerReviewCount > 2;
  const periods = classifyTimePeriod(review.timestamp);
  TIME_PERIODS.forEach((period) => {
    if (period === 'total' || periods[period]) {
      rd.totalReviews[period]++;
      if (isTrusted) {
        rd.trustedReviews[period]++;
        rd.reviewsScores[period] += review.stars === 5 ? 1 : review.stars === 1 ? -1 : 0;
      }
    }
  });
};

const summarizeReviews = async (reviewTexts, filterQuery) => {
  const prompt = filterQuery
    ? `Analyze these ${reviewTexts.length} reviews that mention "${filterQuery}". Focus specifically on what people say about "${filterQuery}".

Rules:
- Every highlight must be about "${filterQuery}" — what people liked, disliked, or noted about it
- Be SPECIFIC: exact details, comparisons, opinions — never generic
- Each highlight can be up to 15 words
- Max 8 highlights, ordered by frequency
- Verdict: 2-3 sentences summarizing the consensus on "${filterQuery}" specifically

${reviewTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : `Analyze these ${reviewTexts.length} reviews. Extract specific highlights mentioned by 2+ people.

Rules:
- Be SPECIFIC: name exact dishes, items, features, staff, locations — never generic ("good food", "nice staff")
- Each highlight can be up to 15 words — give enough detail to be useful
- Max 12 highlights, ordered by frequency
- Rate value for money 1-5
- Verdict: 2-3 sentences capturing the overall picture, what makes this place stand out (or not), and who it's best for

${reviewTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
  const resp = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            highlights: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              text: { type: 'STRING' }, count: { type: 'INTEGER' }, sentiment: { type: 'STRING' }
            }}},
            verdict: { type: 'STRING' },
            valueForMoney: { type: 'INTEGER' }
          }
        },
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  });
  const data = await resp.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
};

const getScorePercentage = (sortKey) => {
  const { reviewsScores, trustedReviews } = scores[sortKey].reviewData;
  return reviewsScores[currentOption] / trustedReviews[currentOption] || 0;
};

// Fetch
const fetchAllReviews = async (sortKey) => {
  const featureId = getFeatureId();
  if (!featureId || scores[sortKey].isFetching) return;

  const state = scores[sortKey];
  state.isFetching = true;
  state.done = false;
  const controller = new AbortController();
  abortControllers[sortKey] = controller;
  updateUI();

  let lastPct = null;
  try {
    while (state.isFetching) {
      const url = buildUrl(featureId, sortKey, state.cursor);
      const resp = await fetch(url, { signal: controller.signal });
      const { reviews, nextCursor } = parseReviewsResponse(await resp.text());

      if (!reviews.length) break;
      for (const r of reviews) {
        if (!state.reviewMap[r.reviewId]) { state.reviewMap[r.reviewId] = r; processReview(r, sortKey); }
      }
      state.pageCount++;
      updateUI();

      if (state.pageCount >= MIN_PAGES_BEFORE_STABILIZE) {
        const pct = getRoundedPct(sortKey);
        if (lastPct !== null && Math.abs(pct - lastPct) <= 1) {
          console.log(`[Reviews] ${sortKey} stabilized at ${pct}% (${getReviewCount(sortKey)} reviews)`);
          break;
        }
        lastPct = pct;
      }
      if (!nextCursor) break;
      state.cursor = nextCursor;
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error(`[Reviews] ${sortKey} error:`, e);
  }
  state.isFetching = false;
  state.done = true;
  abortControllers[sortKey] = null;
  updateUI();
};

const startFetching = () => {
  if (!getFeatureId()) return;
  SORT_KEYS.forEach(fetchAllReviews);
};

// UI — built with DOM methods (innerHTML is safe here but using DOM for clarity)
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

// Cached DOM references per card
const cardEls = {};

const createUIElements = () => {
  const c = el('div'); c.id = 'reviews-container';

  // Header
  const header = el('div', 'rc-header');
  const title = el('span', 'rc-title');
  title.appendChild(el('span', 'rc-dot'));
  title.appendChild(document.createTextNode('Review Analysis'));
  header.appendChild(title);
  const headerRight = el('div', 'rc-header-right');
  const select = document.createElement('select'); select.id = 'rc-period';
  [['total', 'Total'], ['inPastYear', 'Past Year'], ['inPastMonth', 'Past Month']].forEach(([v, t]) => {
    const opt = document.createElement('option'); opt.value = v; opt.textContent = t; select.appendChild(opt);
  });
  select.onchange = (e) => { currentOption = e.target.value; updateUI(); };
  headerRight.appendChild(select);
  const collapseBtn = el('button', 'rc-collapse');
  collapseBtn.textContent = '▾';
  collapseBtn.onclick = () => {
    const collapsed = c.classList.toggle('collapsed');
    collapseBtn.textContent = collapsed ? '▸' : '▾';
  };
  headerRight.appendChild(collapseBtn);
  header.appendChild(headerRight);
  c.appendChild(header);

  // Score cards
  const grid = el('div', 'rc-scores');
  for (const sort of SORT_KEYS) {
    const card = el('div', 'rc-card'); card.dataset.sort = sort;
    const head = el('div', 'rc-card-head');
    head.appendChild(el('span', 'rc-card-label', SORT_LABELS[sort]));
    const countEl = el('span', 'rc-card-count');
    head.appendChild(countEl);
    card.appendChild(head);
    const pctEl = el('div', 'rc-card-pct', '—');
    card.appendChild(pctEl);
    const bar = el('div', 'rc-card-bar');
    const barFill = el('div', 'rc-card-bar-fill');
    bar.appendChild(barFill);
    card.appendChild(bar);
    const detailEl = el('div', 'rc-card-detail');
    card.appendChild(detailEl);
    grid.appendChild(card);
    cardEls[sort] = { card, pctEl, barFill, countEl, detailEl };
  }
  c.appendChild(grid);

  // Trend
  const trend = el('div'); trend.id = 'rc-trend';
  c.appendChild(trend);
  cardEls.trend = trend;

  // Summarize row: button + review count toggle
  const sumRow = el('div', 'rc-sum-row');
  const sumBtn = el('button', 'rc-summarize-btn', 'Summarize');
  sumBtn.onclick = () => triggerSummarize(false);
  sumRow.appendChild(sumBtn);
  const limitToggle = el('div', 'rc-limit-toggle');
  for (const n of [50, 100]) {
    const pill = el('button', `rc-limit-pill${n === reviewLimit ? ' active' : ''}`, String(n));
    pill.onclick = () => {
      reviewLimit = n;
      limitToggle.querySelectorAll('.rc-limit-pill').forEach(p => p.classList.toggle('active', p.textContent == n));
    };
    limitToggle.appendChild(pill);
  }
  sumRow.appendChild(limitToggle);
  c.appendChild(sumRow);
  cardEls.sumBtn = sumBtn;

  const sumPanel = el('div', 'rc-summary-panel');
  sumPanel.style.display = 'none';
  c.appendChild(sumPanel);
  cardEls.sumPanel = sumPanel;
  if (summaryCache.all) renderSummary(sumPanel, summaryCache.all);

  // Search filter
  const searchSec = el('div', 'rc-search-section');
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Filter reviews…';
  searchInput.className = 'rc-search-input';
  searchInput.addEventListener('input', updateSearchSection);
  searchSec.appendChild(searchInput);
  cardEls.searchInput = searchInput;
  const searchResults = el('div', 'rc-search-results');
  searchResults.style.display = 'none';
  searchSec.appendChild(searchResults);
  const filteredSumPanel = el('div', 'rc-summary-panel');
  filteredSumPanel.style.display = 'none';
  searchSec.appendChild(filteredSumPanel);
  c.appendChild(searchSec);
  cardEls.searchResults = searchResults;
  cardEls.filteredSumPanel = filteredSumPanel;

  document.body.appendChild(c);
};

const updateUI = () => {
  if (!document.querySelector('#reviews-container')) createUIElements();

  for (const sortKey of SORT_KEYS) {
    const state = scores[sortKey];
    const els = cardEls[sortKey];
    if (!els) continue;

    const count = getReviewCount(sortKey);
    const pct = getScorePercentage(sortKey);
    const pctRound = Math.round(pct * 100);
    const trusted = state.reviewData.trustedReviews[currentOption];
    const all = state.reviewData.totalReviews[currentOption];

    if (count > 0) {
      els.pctEl.textContent = `${pctRound}%`;
      const color = getScoreColor(Math.max(0, pct));
      els.pctEl.style.color = color;
      els.pctEl.style.textShadow = `0 0 24px ${color}40`;
    } else {
      els.pctEl.textContent = '—';
      els.pctEl.style.color = ''; els.pctEl.style.textShadow = '';
    }

    // Maps pct from [-1,1] → [0%,100%] for bar width
    els.barFill.style.width = count > 0 ? `${Math.max(2, Math.min(100, (pct + 1) / 2 * 100))}%` : '0%';
    els.countEl.textContent = count > 0 ? count : '';
    els.detailEl.textContent = all > 0 ? `${trusted} trusted of ${all}` : '';
    els.card.classList.toggle('loading', state.isFetching);
    els.card.classList.toggle('done', state.done);
  }

  // Trend — compare each sort vs overall baseline from star breakdown
  const trendEl = cardEls.trend;
  const fullPct = calculateFullPercentage();
  const hasData = SORT_KEYS.some(k => getReviewCount(k) > 0);
  const anyFetching = SORT_KEYS.some(k => scores[k].isFetching);

  if (fullPct !== null && hasData) {
    const lines = [];
    for (const key of SORT_KEYS) {
      if (getReviewCount(key) === 0) continue;
      const pct = getRoundedPct(key);
      const diff = pct - fullPct;
      const sign = diff > 0 ? '+' : '';
      const cls = diff > 1 ? 'positive' : diff < -1 ? 'negative' : 'neutral';
      lines.push(`<span class="${cls}">${getTrendIcon(diff)} ${SORT_LABELS[key]} ${sign}${diff}% vs overall (${fullPct}%)</span>`);
    }
    trendEl.innerHTML = lines.join('\n'); // all values are computed numbers, safe
    trendEl.className = 'rc-trend';
  } else if (hasData && !anyFetching) {
    const diff = getRoundedPct('newest') - getRoundedPct('relevant');
    if (Math.abs(diff) <= 1) { trendEl.textContent = '→ Consistent across sort orders'; trendEl.className = 'rc-trend neutral'; }
    else if (diff > 0) { trendEl.textContent = `↗ Newest +${diff}% vs Relevant`; trendEl.className = 'rc-trend positive'; }
    else { trendEl.textContent = `↘ Newest ${diff}% vs Relevant`; trendEl.className = 'rc-trend negative'; }
  } else if (anyFetching) {
    trendEl.textContent = 'Analyzing reviews…';
    trendEl.className = 'rc-trend loading';
  } else {
    trendEl.textContent = '';
    trendEl.className = 'rc-trend';
  }

};

// Summarize
const renderSummary = (panel, result) => {
  panel.textContent = '';
  panel.className = 'rc-summary-panel';
  panel.style.display = 'block';
  if (result.highlights?.length) {
    for (const h of result.highlights) {
      const row = el('div', `rc-highlight ${h.sentiment}`);
      const badge = el('span', 'rc-h-count', `${h.count}x`);
      row.appendChild(badge);
      row.appendChild(document.createTextNode(` ${h.text}`));
      panel.appendChild(row);
    }
  }
  if (result.valueForMoney) {
    panel.appendChild(el('div', 'rc-value', `Value for money: ${'★'.repeat(result.valueForMoney)}${'☆'.repeat(5 - result.valueForMoney)}`));
  }
  if (result.verdict) {
    panel.appendChild(el('div', 'rc-verdict', result.verdict));
  }
  if (!result.highlights?.length && !result.verdict) {
    panel.textContent = 'No highlights found';
  }
};

const triggerSummarize = async (filtered) => {
  const panel = filtered ? cardEls.filteredSumPanel : cardEls.sumPanel;
  if (!panel) return;
  panel.style.display = 'block';
  panel.textContent = 'Summarizing…';
  panel.className = 'rc-summary-panel loading';

  // Combine reviews from both sort keys (deduped by reviewMap keys)
  const combined = { ...scores.relevant.reviewMap, ...scores.newest.reviewMap };
  let reviews = Object.values(combined).filter(r => r.text);

  const query = filtered ? cardEls.searchInput?.value?.trim() : null;
  if (query) reviews = reviews.filter(r => r.text.toLowerCase().includes(query.toLowerCase()));

  const texts = [...new Set(reviews.map(r => r.text))].sort((a, b) => b.length - a.length).slice(0, reviewLimit);
  if (!texts.length) { panel.textContent = 'No review text available'; panel.className = 'rc-summary-panel'; return; }

  try {
    const result = await summarizeReviews(texts, query);
    summaryCache[filtered ? 'filtered' : 'all'] = result;
    saveSummaryCache();
    renderSummary(panel, result);
  } catch (e) {
    console.error('[Reviews] Summarize error:', e);
    panel.textContent = 'Summarization failed';
    panel.className = 'rc-summary-panel';
  }
};

// Search filter
const updateSearchSection = () => {
  const res = cardEls.searchResults;
  if (!res) return;
  const query = cardEls.searchInput?.value?.trim();
  if (!query) { res.style.display = 'none'; if (cardEls.filteredSumPanel) cardEls.filteredSumPanel.style.display = 'none'; return; }

  // Combine both sort keys for larger sample
  const combined = { ...scores.relevant.reviewMap, ...scores.newest.reviewMap };
  const allReviews = Object.values(combined);
  const filtered = allReviews.filter(r => r.text && r.text.toLowerCase().includes(query.toLowerCase()));

  if (!filtered.length) {
    res.style.display = 'block';
    res.textContent = `No reviews mention "${query}" (in ${allReviews.length} sampled)`;
    return;
  }

  const trusted = filtered.filter(r => r.reviewerReviewCount > 2);
  const score = trusted.reduce((s, r) => s + (r.stars === 5 ? 1 : r.stars === 1 ? -1 : 0), 0);
  const pct = trusted.length ? Math.round((score / trusted.length) * 100) : 0;
  const color = getScoreColor(Math.max(0, score / (trusted.length || 1)));

  res.style.display = 'block';
  res.textContent = '';
  const header = el('div', 'rc-search-header');
  const scoreEl = el('span', 'rc-search-score', `${pct}%`);
  scoreEl.style.color = color;
  header.appendChild(scoreEl);
  header.appendChild(el('span', 'rc-search-count', `${filtered.length} of ${allReviews.length} mention "${query}"`));
  res.appendChild(header);

  const sumBtn = el('button', 'rc-summarize-btn', `Summarize "${query}"`);
  sumBtn.onclick = () => triggerSummarize(true);
  res.appendChild(sumBtn);
};

// Observer — skip work if URL hasn't changed since last mutation
const observer = new MutationObserver(() => {
  const url = location.href;
  if (url === lastUrl) return;
  lastUrl = url;

  const isPlace = /\/place\//.test(url);
  if (!isPlace) { document.querySelector('#reviews-container')?.remove(); return; }

  const placeName = url.match(/(?:place\/)([^\/]+)/)?.[1];
  if (placeName !== lastPlaceName) {
    lastPlaceName = placeName;
    resetScores();
    loadSummaryCache();
    document.querySelector('#reviews-container')?.remove();
    startFetching();
  }
  if (!document.querySelector('#reviews-container') && getFeatureId()) {
    updateUI();
    if (!scores.relevant.isFetching && !scores.relevant.done) startFetching();
  }
});

observer.observe(document.body, { childList: true, subtree: true });
