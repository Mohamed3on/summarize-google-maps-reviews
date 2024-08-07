// Constants and State
const TIME_PERIODS = ['total', 'inPastYear', 'inPastMonth'];
const PERCENT_COLORS = [
  { pct: 0.0, color: { r: 0xff, g: 0x00, b: 0 } },
  { pct: 0.5, color: { r: 0xff, g: 0xff, b: 0 } },
  { pct: 1.0, color: { r: 0x00, g: 0xff, b: 0 } },
];

let reviewMap = {};
let currentOption = 'total';

// Helper functions
const createDataObject = () => Object.fromEntries(TIME_PERIODS.map((period) => [period, 0]));

const reviewData = {
  reviewsScores: createDataObject(),
  trustedReviews: createDataObject(),
  totalReviews: createDataObject(),
};

const reset = () => {
  reviewMap = {};
  Object.values(reviewData).forEach((data) => TIME_PERIODS.forEach((period) => (data[period] = 0)));
};

const getColorForPercentage = (pct) => {
  // Find the appropriate color range
  const i = PERCENT_COLORS.findIndex((color) => pct <= color.pct);
  const [lower, upper] = [
    PERCENT_COLORS[Math.max(0, i - 1)],
    PERCENT_COLORS[Math.min(PERCENT_COLORS.length - 1, i)],
  ];

  // Calculate the percentage within this specific range
  const rangePct = (pct - lower.pct) / (upper.pct - lower.pct);

  // Interpolate the color
  const color = ['r', 'g', 'b'].reduce((acc, key) => {
    acc[key] = Math.round(lower.color[key] + rangePct * (upper.color[key] - lower.color[key]));
    return acc;
  }, {});

  return {
    textColor: 'black',
    backgroundColor: `rgb(${color.r},${color.g},${color.b})`,
  };
};

const applyColors = (element, percentage, isTrusted = false) => {
  const styles = isTrusted
    ? { color: 'black', backgroundColor: percentage < 0.35 ? 'red' : 'aquamarine' }
    : getColorForPercentage(percentage);
  Object.assign(element.style, styles);
};

// Review processing
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

// UI management
const createUIElements = () => {
  const container = document.createElement('div');
  container.id = 'reviews-container';

  ['reviews-score', 'trusted-reviews'].forEach((id) => {
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

  const scrollButton = document.createElement('button');
  scrollButton.id = 'scroll-button';
  scrollButton.innerText = 'Auto-scroll';
  scrollButton.onclick = scrollUntilStabilized;
  scrollButtonsContainer.appendChild(scrollButton);

  const scrollToTopButton = document.createElement('button');
  scrollToTopButton.id = 'scroll-to-top-button';
  scrollToTopButton.innerText = '↑';
  scrollToTopButton.onclick = scrollToFirstReview;
  scrollButtonsContainer.appendChild(scrollToTopButton);

  controlsContainer.appendChild(scrollButtonsContainer);

  container.appendChild(controlsContainer);

  document.body.appendChild(container);
};

const getReviewScorePercentage = () => {
  const { reviewsScores, trustedReviews } = reviewData;
  return reviewsScores[currentOption] / trustedReviews[currentOption] || 0;
};

const updateUI = () => {
  const scoreElement = document.querySelector('#reviews-score');
  const trustedElement = document.querySelector('#trusted-reviews');

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
};

// Main logic
const queueReviews = () => {
  const reviews = document.querySelectorAll('.jftiEf.fontBodyMedium');
  const newReviews = Array.from(reviews).filter(
    (review) => !reviewMap[review.getAttribute('data-review-id')]
  );
  if (newReviews.length) {
    parseReviews(newReviews);
  }
};

let lastPlaceName = '';
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

observer.observe(document.body, { childList: true, subtree: true });

// Modify these variables
let isScrolling = false;
let lastPercentage = null;

const scrollToLastReview = () => {
  const reviews = document.querySelectorAll('[data-review-id]');
  const lastReview = [...reviews].pop();
  if (lastReview) {
    lastReview.scrollIntoView();
  } else {
    console.error('No review found');
  }
};

// Simplify the checkStabilization function
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
    await new Promise((resolve) => setTimeout(resolve, 100)); // Check every 100ms
    const currentReviewCount = document.querySelectorAll('[data-review-id]').length;
    if (currentReviewCount > initialReviewCount) {
      return true; // New reviews have appeared
    }
  }
  return false; // Timeout reached, no new reviews
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
      isScrolling = false;
      break;
    }

    queueReviews();

    const newPercentage = Math.round(getReviewScorePercentage() * 100);
    if (checkStabilization(newPercentage)) {
      isScrolling = false;
    }

    // Update UI after each scroll
    updateUI();

    // Add a small delay to prevent excessive CPU usage
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Reset scrolling state and update UI one final time
  isScrolling = false;
  updateUI();

  // Notify the user that scrolling has finished
  console.log('Scrolling finished. Reviews have stabilized or all reviews have been loaded.');
};

const scrollToFirstReview = () => {
  const top = document.querySelector('.fontDisplayLarge');
  if (top) {
    top.scrollIntoView();
  }
};

// Add this function to load the CSS file
const loadStyles = () => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'styles.css';
  document.head.appendChild(link);
};

// Call this function before creating UI elements
loadStyles();
