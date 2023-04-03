let reviewMap = {};

const INITIAL_OPTION = 'inPastMonth';

let currentOption = INITIAL_OPTION;

const reviewsScores = {
  total: 0,
  inPastYear: 0,
  inPastMonth: 0,
};

const trustedReviews = {
  total: 0,
  inPastYear: 0,
  inPastMonth: 0,
};

const resetReviewData = () => {
  reviewsScores.total = 0;
  reviewsScores.inPastYear = 0;
  reviewsScores.inPastMonth = 0;
  trustedReviews.total = 0;
  trustedReviews.inPastYear = 0;
  trustedReviews.inPastMonth = 0;
};
const reset = () => {
  reviewMap = {};
  resetReviewData();
};

var percentColors = [
  { pct: 0.0, color: { r: 0xff, g: 0x00, b: 0 } },
  { pct: 0.5, color: { r: 0xff, g: 0xff, b: 0 } },
  { pct: 1.0, color: { r: 0x00, g: 0xff, b: 0 } },
];

var getColorForPercentage = function (pct) {
  for (var i = 1; i < percentColors.length - 1; i++) {
    if (pct < percentColors[i].pct) {
      break;
    }
  }
  var lower = percentColors[i - 1];
  var upper = percentColors[i];
  var range = upper.pct - lower.pct;
  var rangePct = (pct - lower.pct) / range;
  var pctLower = 1 - rangePct;
  var pctUpper = rangePct;
  var color = {
    r: Math.floor(lower.color.r * pctLower + upper.color.r * pctUpper),
    g: Math.floor(lower.color.g * pctLower + upper.color.g * pctUpper),
    b: Math.floor(lower.color.b * pctLower + upper.color.b * pctUpper),
  };

  let textColor = 'black';
  return { textColor, backgroundColor: 'rgb(' + [color.r, color.g, color.b].join(',') + ')' };
  // or output as hex if preferred
};

const applyColorsForElement = (element, percentage) => {
  let { textColor, backgroundColor } = getColorForPercentage(percentage);
  element.style.color = textColor;
  element.style.backgroundColor = backgroundColor;
};

const getReviewScores = (reviewMap) => {
  resetReviewData();
  return Object.values(reviewMap).reduce(
    (acc, { rating, reviewerNumberOfReviews, inPastYear, inPastMonth }) => {
      if (reviewerNumberOfReviews > 2) {
        acc.trustedReviews.total++;

        if (inPastMonth) {
          acc.trustedReviews.inPastMonth++;
        }
        if (inPastYear) {
          acc.trustedReviews.inPastYear++;
        }

        if (rating === 5) {
          acc.reviewsScores.total++;
          if (inPastMonth) {
            acc.reviewsScores.inPastMonth++;
          }
          if (inPastYear) {
            acc.reviewsScores.inPastYear++;
          }
        }

        if (rating === 1) {
          acc.reviewsScores.total--;

          if (inPastMonth) {
            acc.reviewsScores.inPastMonth--;
          }
          if (inPastYear) {
            acc.reviewsScores.inPastYear--;
          }
        }
      }
      return acc;
    },
    {
      reviewsScores,
      trustedReviews,
    }
  );
};

const parseReviews = (reviews) => {
  Array.from(reviews).forEach((review) => {
    const reviewId = review.getAttribute('data-review-id');

    if (reviewMap[reviewId]) {
      return;
    }

    let rating;

    try {
      rating = review
        .querySelector('[role="img"].kvMYJc')
        .getAttribute('aria-label')
        .match(/(\d)(?<!stars)/)?.[0];
      // for hotels, the rating format is different (4/5)
    } catch (e) {
      rating = review.querySelector('span.fzvQIb').innerText.match(/\d/)?.[0];
    }

    const reviewerNumberOfReviews =
      review.querySelector('.RfnDt')?.innerText.match(/(\d+)/)?.[0] || 1;

    const IsReviewYoungerThanAYear = !review.querySelector('.rsqaWe')?.innerText.match(/year/);
    const isReviewYoungerThanAMonth =
      IsReviewYoungerThanAYear && !review.querySelector('.rsqaWe')?.innerText.match(/month/);

    reviewMap[reviewId] = {
      rating: parseInt(rating),
      reviewerNumberOfReviews: parseInt(reviewerNumberOfReviews),
      inPastYear: IsReviewYoungerThanAYear,
      inPastMonth: isReviewYoungerThanAMonth,
    };
  });

  const { reviewsScores, trustedReviews } = getReviewScores(reviewMap);

  const options = {
    inPastMonth: 'Past Month',
    inPastYear: 'Past Year',
    total: 'Total',
  };

  let recentReviewScoreElement = document.querySelector('#reviews-container');
  let reviewScoreAsPercentageElement = document.querySelector('#reviews-score');
  let trustedReviewsElement = document.querySelector('#trusted-reviews');

  if (!recentReviewScoreElement) {
    recentReviewScoreElement = document.createElement('div');
    recentReviewScoreElement.id = 'reviews-container';

    document.body.appendChild(recentReviewScoreElement);

    reviewScoreAsPercentageElement = document.createElement('div');
    reviewScoreAsPercentageElement.id = 'reviews-score';
    recentReviewScoreElement.appendChild(reviewScoreAsPercentageElement);

    trustedReviewsElement = document.createElement('div');
    trustedReviewsElement.id = 'trusted-reviews';
    recentReviewScoreElement.appendChild(trustedReviewsElement);

    const selectOptionElement = document.createElement('select');
    selectOptionElement.id = 'select-option';

    Object.keys(options).forEach((option) => {
      const optionElement = document.createElement('option');
      optionElement.value = option;
      optionElement.innerText = options[option];
      selectOptionElement.appendChild(optionElement);
    });
    selectOptionElement.onchange = () => {
      currentOption = selectOptionElement.value;
      renderValuesInThePage();
    };
    recentReviewScoreElement.appendChild(selectOptionElement);
  }

  const renderValuesInThePage = () => {
    const recentReviewScorePercentage =
      reviewsScores[currentOption] / trustedReviews[currentOption] || 0;

    reviewScoreAsPercentageElement.innerText = `${Math.round(
      reviewsScores[currentOption] * recentReviewScorePercentage
    )} - ${Math.round(recentReviewScorePercentage * 100)}%`;

    trustedReviewsElement.innerText = `${trustedReviews[currentOption]} trusted reviews in this period`;

    applyColorsForElement(document.querySelector('#reviews-score'), recentReviewScorePercentage);
  };

  renderValuesInThePage();
};

let lastPlaceName = location.href.match(/(?:place\/)([^\/]+)/)?.[1];

const queueReviews = () => {
  const reviews = document.querySelectorAll('.jftiEf.fontBodyMedium');
  const newReviews = Array.from(reviews).filter(
    (review) => !reviewMap[review.getAttribute('data-review-id')]
  );
  if (newReviews.length) {
    parseReviews(newReviews);
  }
};
const observer = new MutationObserver(async function () {
  let placeName = location.href.match(/(?:place\/)([^\/]+)/)?.[1];

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

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
