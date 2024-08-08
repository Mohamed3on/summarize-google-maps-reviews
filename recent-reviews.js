// Constants
const TIME_PERIODS = ['total', 'inPastYear', 'inPastMonth'];
const PERCENT_COLORS = [
  { pct: 0.0, color: { r: 0xff, g: 0x00, b: 0 } },
  { pct: 0.5, color: { r: 0xff, g: 0xff, b: 0 } },
  { pct: 1.0, color: { r: 0x00, g: 0xff, b: 0 } },
];

// State
let reviewMap = {};
let currentOption = 'total';
let fullPercentage = null;
let isScrolling = false;
let lastPercentage = null;
let lastPlaceName = '';

const reviewData = {
  reviewsScores: Object.fromEntries(TIME_PERIODS.map((period) => [period, 0])),
  trustedReviews: Object.fromEntries(TIME_PERIODS.map((period) => [period, 0])),
  totalReviews: Object.fromEntries(TIME_PERIODS.map((period) => [period, 0])),
};

// Helper functions
const reset = () => {
  reviewMap = {};
  Object.values(reviewData).forEach((data) => TIME_PERIODS.forEach((period) => (data[period] = 0)));
  fullPercentage = calculateFullPercentage();
};

const getColorForPercentage = (pct) => {
  const i = PERCENT_COLORS.findIndex((color) => pct <= color.pct);
  const [lower, upper] = [
    PERCENT_COLORS[Math.max(0, i - 1)],
    PERCENT_COLORS[Math.min(PERCENT_COLORS.length - 1, i)],
  ];
  const rangePct = (pct - lower.pct) / (upper.pct - lower.pct);
  const color = ['r', 'g', 'b'].reduce((acc, key) => {
    acc[key] = Math.round(lower.color[key] + rangePct * (upper.color[key] - lower.color[key]));
    return acc;
  }, {});
  return { textColor: 'black', backgroundColor: `rgb(${color.r},${color.g},${color.b})` };
};

const applyColors = (element, percentage, isTrusted = false) => {
  const styles = isTrusted
    ? { color: 'black', backgroundColor: percentage < 0.35 ? 'red' : 'aquamarine' }
    : getColorForPercentage(percentage);
  Object.assign(element.style, styles);
};

const processReview = (review) => {
  const { rating, reviewerNumberOfReviews } = review;
  const isTrusted = reviewerNumberOfReviews > 2;
  TIME_PERIODS.forEach((period) => {
    if (period === 'total' || review[period]) {
      reviewData.totalReviews[period]++;
      if (isTrusted) {
        reviewData.trustedReviews[period]++;
        reviewData.reviewsScores[period] += rating === 5 ? 1 : rating === 1 ? -1 : 0;
      }
    }
  });
};

const parseReviews = (reviews) => {
  Array.from(reviews).forEach((review) => {
    const reviewId = review.getAttribute('data-review-id');
    if (reviewMap[reviewId]) return;
    const rating =
      review
        .querySelector('[role="img"].kvMYJc')
        ?.getAttribute('aria-label')
        .match(/(\d)(?<!stars)/)?.[0] ||
      review.querySelector('span.fzvQIb')?.innerText.match(/\d/)?.[0];
    const reviewerNumberOfReviews =
      review.querySelector('.RfnDt')?.innerText.match(/(\d+)/)?.[0] || 1;
    const reviewDate = review.querySelector('.rsqaWe, .xRkPPb')?.innerText || '';
    reviewMap[reviewId] = {
      rating: parseInt(rating),
      reviewerNumberOfReviews: parseInt(reviewerNumberOfReviews),
      inPastYear: !reviewDate.includes('year'),
      inPastMonth: !reviewDate.includes('year') && !reviewDate.includes('month'),
    };
  });
  Object.values(reviewMap).forEach(processReview);
  updateUI();
};

const getReviewScorePercentage = () => {
  const { reviewsScores, trustedReviews } = reviewData;
  return reviewsScores[currentOption] / trustedReviews[currentOption] || 0;
};

const calculateFullPercentage = () => {
  const reviewRows = document.querySelectorAll('tr[role="img"]');
  if (reviewRows.length < 5) return null;
  const extractNumber = (str) => {
    const match = str.match(/(\d+(?:[.,]\d+)*)\s*(?:reviews?|$)/);
    return match ? parseInt(match[1].replace(/[.,]/g, ''), 10) : 0;
  };
  const fiveStars = extractNumber(reviewRows[0].getAttribute('aria-label'));
  const oneStars = extractNumber(reviewRows[4].getAttribute('aria-label'));
  const allReviews = extractNumber(document.querySelector('.jANrlb>.fontBodySmall')?.innerText);
  if (!allReviews) return null;
  return Math.round(((fiveStars - oneStars) / allReviews) * 100);
};

// UI functions
const createUIElements = () => {
  const container = document.createElement('div');
  container.id = 'reviews-container';
  ['reviews-score', 'trusted-reviews', 'review-trend'].forEach((id) => {
    const element = document.createElement('div');
    element.id = id;
    container.appendChild(element);
  });
  const controlsContainer = document.createElement('div');
  controlsContainer.className = 'controls-container';
  const selectElement = document.createElement('select');
  selectElement.id = 'select-option';
  TIME_PERIODS.forEach((option) => {
    const optionElement = document.createElement('option');
    optionElement.value = option;
    optionElement.innerText =
      option === 'total' ? 'Total' : option === 'inPastYear' ? 'Past Year' : 'Past Month';
    selectElement.appendChild(optionElement);
  });
  selectElement.onchange = (e) => {
    currentOption = e.target.value;
    updateUI();
  };
  controlsContainer.appendChild(selectElement);
  const scrollButtonsContainer = document.createElement('div');
  scrollButtonsContainer.className = 'scroll-buttons';
  ['Auto-scroll (⌥)', '↑'].forEach((text, index) => {
    const button = document.createElement('button');
    button.id = index === 0 ? 'scroll-button' : 'scroll-to-top-button';
    button.innerText = text;
    button.onclick = index === 0 ? scrollUntilStabilized : scrollToFirstReview;
    scrollButtonsContainer.appendChild(button);
  });
  controlsContainer.appendChild(scrollButtonsContainer);
  container.appendChild(controlsContainer);
  document.body.appendChild(container);
};

const updateUI = () => {
  const scoreElement = document.querySelector('#reviews-score');
  const trustedElement = document.querySelector('#trusted-reviews');
  const trendElement = document.querySelector('#review-trend');
  if (!scoreElement) {
    createUIElements();
    return updateUI();
  }
  const { reviewsScores, trustedReviews, totalReviews } = reviewData;
  const recentReviewScorePercentage = getReviewScorePercentage();
  scoreElement.innerText = `${Math.round(
    reviewsScores[currentOption] * recentReviewScorePercentage
  )} - ${Math.round(recentReviewScorePercentage * 100)}%`;
  trustedElement.innerText = `${
    trustedReviews[currentOption]
  } trusted reviews in this period (${Math.round(
    (trustedReviews[currentOption] / totalReviews[currentOption]) * 100
  )}%)`;
  applyColors(scoreElement, recentReviewScorePercentage);
  applyColors(trustedElement, trustedReviews[currentOption] / totalReviews[currentOption], true);
  if (fullPercentage !== null) {
    const recentPercentage = Math.round(recentReviewScorePercentage * 100);
    const difference = recentPercentage - fullPercentage;
    const trendText = difference >= 0 ? 'Positive' : 'Negative';
    const trendColor =
      difference >= 0
        ? `rgb(0, ${Math.min(255, 128 + Math.abs(difference) * 5)}, 0)`
        : `rgb(${Math.min(255, 128 + Math.abs(difference) * 5)}, 0, 0)`;
    trendElement.innerText = `${trendText} recent reviews trend (${
      difference >= 0 ? '+' : ''
    }${difference}%)`;
    trendElement.style.backgroundColor = trendColor;
    trendElement.classList.remove('trend-unavailable');
  } else {
    trendElement.innerText = 'Recent trend data not available';
    trendElement.classList.add('trend-unavailable');
  }
};

// Main logic
const queueReviews = () => {
  const reviews = document.querySelectorAll('.jftiEf.fontBodyMedium');
  const newReviews = Array.from(reviews).filter(
    (review) => !reviewMap[review.getAttribute('data-review-id')]
  );
  if (newReviews.length) parseReviews(newReviews);
};

const observer = new MutationObserver(() => {
  const placeName = location.href.match(/(?:place\/)([^\/]+)/)?.[1];
  const reviews = document.querySelectorAll('.jftiEf.fontBodyMedium');
  if (reviews.length > 4) {
    if (placeName !== lastPlaceName) {
      lastPlaceName = placeName;
      reset();
    }
    queueReviews();
  } else {
    reset();
    document.querySelector('#reviews-container')?.remove();
  }
});

// Scrolling functions
const scrollToLastReview = () => {
  const reviews = document.querySelectorAll('[data-review-id]');
  const lastReview = [...reviews].pop();
  if (lastReview) lastReview.scrollIntoView();
  else console.error('No review found');
};

const checkStabilization = (currentPercentage) => {
  if (lastPercentage === null) {
    lastPercentage = currentPercentage;
    return false;
  }
  const isStabilized = Math.abs(currentPercentage - lastPercentage) <= 1;
  lastPercentage = currentPercentage;
  return isStabilized;
};

const waitForNewReviews = async (timeout = 5000) => {
  const startTime = Date.now();
  const initialReviewCount = document.querySelectorAll('[data-review-id]').length;
  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (document.querySelectorAll('[data-review-id]').length > initialReviewCount) return true;
  }
  return false;
};

const scrollUntilStabilized = async () => {
  if (isScrolling) return;
  isScrolling = true;
  lastPercentage = null;
  while (isScrolling) {
    scrollToLastReview();
    const newReviewsAppeared = await waitForNewReviews();
    if (!newReviewsAppeared) {
      console.log('No new reviews appeared after 5 seconds. Stopping scroll.');
      break;
    }
    queueReviews();
    const newPercentage = Math.round(getReviewScorePercentage() * 100);
    if (checkStabilization(newPercentage)) break;
    updateUI();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  isScrolling = false;
  updateUI();
  console.log('Scrolling finished. Reviews have stabilized or all reviews have been loaded.');
};

const scrollToFirstReview = () => {
  document.querySelector('.fontDisplayLarge')?.scrollIntoView();
};

// Initialize
const loadStyles = () => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'styles.css';
  document.head.appendChild(link);
};

loadStyles();
observer.observe(document.body, { childList: true, subtree: true });

// Update keyboard shortcut for Mac
document.addEventListener('keydown', (event) => {
  if (event.altKey) {
    event.preventDefault();
    scrollUntilStabilized();
  }
});
