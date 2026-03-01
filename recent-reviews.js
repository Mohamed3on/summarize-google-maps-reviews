// Constants
const TIME_PERIODS = ['total', 'inPastYear', 'inPastMonth'];
const PAGE_SIZE = 20;
const MIN_PAGES_BEFORE_STABILIZE = 2;

// State
let currentOption = 'total';
let fullPercentage = null;
let lastPlaceName = '';
let abortControllers = { relevant: null, newest: null };

const makeReviewData = () => ({
  reviewsScores: Object.fromEntries(TIME_PERIODS.map((p) => [p, 0])),
  trustedReviews: Object.fromEntries(TIME_PERIODS.map((p) => [p, 0])),
  totalReviews: Object.fromEntries(TIME_PERIODS.map((p) => [p, 0])),
});

const scores = {
  relevant: { reviewMap: {}, reviewData: makeReviewData(), isFetching: false, done: false, cursor: '', pageCount: 0 },
  newest: { reviewMap: {}, reviewData: makeReviewData(), isFetching: false, done: false, cursor: '', pageCount: 0 },
};

// Helpers
const resetScores = () => {
  for (const key of ['relevant', 'newest']) {
    scores[key] = { reviewMap: {}, reviewData: makeReviewData(), isFetching: false, done: false, cursor: '', pageCount: 0 };
    if (abortControllers[key]) { abortControllers[key].abort(); abortControllers[key] = null; }
  }
  fullPercentage = null;
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
      if (reviewId && stars) reviews.push({ reviewId, stars, reviewerReviewCount, timestamp });
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
        const pct = Math.round(getScorePercentage(sortKey) * 100);
        if (lastPct !== null && Math.abs(pct - lastPct) <= 1) {
          console.log(`[Reviews] ${sortKey} stabilized at ${pct}% (${Object.keys(state.reviewMap).length} reviews)`);
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
  fetchAllReviews('relevant');
  fetchAllReviews('newest');
};

// UI — built with DOM methods (innerHTML is safe here but using DOM for clarity)
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const createUIElements = () => {
  const c = el('div'); c.id = 'reviews-container';

  // Header
  const header = el('div', 'rc-header');
  const title = el('span', 'rc-title');
  title.appendChild(el('span', 'rc-dot'));
  title.appendChild(document.createTextNode('Review Analysis'));
  header.appendChild(title);
  const select = document.createElement('select'); select.id = 'rc-period';
  [['total', 'Total'], ['inPastYear', 'Past Year'], ['inPastMonth', 'Past Month']].forEach(([v, t]) => {
    const opt = document.createElement('option'); opt.value = v; opt.textContent = t; select.appendChild(opt);
  });
  select.onchange = (e) => { currentOption = e.target.value; updateUI(); };
  header.appendChild(select);
  c.appendChild(header);

  // Score cards
  const grid = el('div', 'rc-scores');
  for (const sort of ['relevant', 'newest']) {
    const card = el('div', 'rc-card'); card.dataset.sort = sort;
    const head = el('div', 'rc-card-head');
    head.appendChild(el('span', 'rc-card-label', sort === 'relevant' ? 'Relevant' : 'Newest'));
    head.appendChild(el('span', 'rc-card-count'));
    card.appendChild(head);
    card.appendChild(el('div', 'rc-card-pct', '—'));
    const bar = el('div', 'rc-card-bar');
    bar.appendChild(el('div', 'rc-card-bar-fill'));
    card.appendChild(bar);
    card.appendChild(el('div', 'rc-card-detail'));
    grid.appendChild(card);
  }
  c.appendChild(grid);

  // Trend
  const trend = el('div'); trend.id = 'rc-trend';
  c.appendChild(trend);

  document.body.appendChild(c);
};

const updateUI = () => {
  if (!document.querySelector('#reviews-container')) createUIElements();

  for (const sortKey of ['relevant', 'newest']) {
    const state = scores[sortKey];
    const card = document.querySelector(`.rc-card[data-sort="${sortKey}"]`);
    if (!card) continue;

    const total = Object.keys(state.reviewMap).length;
    const pct = getScorePercentage(sortKey);
    const pctRound = Math.round(pct * 100);
    const trusted = state.reviewData.trustedReviews[currentOption];
    const all = state.reviewData.totalReviews[currentOption];

    const pctEl = card.querySelector('.rc-card-pct');
    if (total > 0) {
      pctEl.textContent = `${pctRound}%`;
      const color = getScoreColor(Math.max(0, pct));
      pctEl.style.color = color;
      pctEl.style.textShadow = `0 0 24px ${color}40`;
    } else {
      pctEl.textContent = '—';
      pctEl.style.color = ''; pctEl.style.textShadow = '';
    }

    card.querySelector('.rc-card-bar-fill').style.width =
      total > 0 ? `${Math.max(2, Math.min(100, (pct + 1) / 2 * 100))}%` : '0%';
    card.querySelector('.rc-card-count').textContent = total > 0 ? total : '';
    card.querySelector('.rc-card-detail').textContent = all > 0 ? `${trusted} trusted of ${all}` : '';
    card.classList.toggle('loading', state.isFetching);
    card.classList.toggle('done', state.done);
  }

  // Trend — compare each sort vs overall baseline from star breakdown
  const trendEl = document.querySelector('#rc-trend');
  fullPercentage = calculateFullPercentage();
  const hasData = Object.keys(scores.relevant.reviewMap).length > 0 || Object.keys(scores.newest.reviewMap).length > 0;
  const anyFetching = scores.relevant.isFetching || scores.newest.isFetching;

  if (fullPercentage !== null && hasData) {
    const lines = [];
    for (const [key, label] of [['relevant', 'Relevant'], ['newest', 'Newest']]) {
      if (Object.keys(scores[key].reviewMap).length === 0) continue;
      const pct = Math.round(getScorePercentage(key) * 100);
      const diff = pct - fullPercentage;
      const sign = diff > 0 ? '+' : '';
      const icon = diff > 1 ? '↗' : diff < -1 ? '↘' : '→';
      lines.push(`${icon} ${label} ${sign}${diff}% vs overall (${fullPercentage}%)`);
    }
    trendEl.textContent = lines.join('\n');
    // Color based on worst trend
    const diffs = ['relevant', 'newest']
      .filter(k => Object.keys(scores[k].reviewMap).length > 0)
      .map(k => Math.round(getScorePercentage(k) * 100) - fullPercentage);
    const worst = Math.min(...diffs);
    trendEl.className = `rc-trend ${worst > 1 ? 'positive' : worst < -1 ? 'negative' : 'neutral'}`;
  } else if (hasData && !anyFetching) {
    // No star breakdown available — compare sorts to each other
    const relPct = Math.round(getScorePercentage('relevant') * 100);
    const newPct = Math.round(getScorePercentage('newest') * 100);
    const diff = newPct - relPct;
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

// Observer
const observer = new MutationObserver(() => {
  const isPlace = /\/place\//.test(location.href);
  if (!isPlace) { document.querySelector('#reviews-container')?.remove(); return; }

  const placeName = location.href.match(/(?:place\/)([^\/]+)/)?.[1];
  if (placeName !== lastPlaceName) {
    lastPlaceName = placeName;
    resetScores();
    document.querySelector('#reviews-container')?.remove();
    startFetching();
  }
  if (!document.querySelector('#reviews-container') && getFeatureId()) {
    updateUI();
    if (!scores.relevant.isFetching && !scores.relevant.done) startFetching();
  }
});

observer.observe(document.body, { childList: true, subtree: true });
