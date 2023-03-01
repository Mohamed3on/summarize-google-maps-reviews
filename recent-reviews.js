let reviewMap = {};

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
      review.querySelector('.RfnDt > span:nth-child(2)')?.innerText.match(/(\d+)/)?.[0] || 1;

    reviewMap[reviewId] = {
      rating: parseInt(rating),
      reviewerNumberOfReviews: parseInt(reviewerNumberOfReviews),
    };
  });

  const { reviewsScore, totalTrustedReviews } = Object.values(reviewMap).reduce(
    (acc, { rating, reviewerNumberOfReviews }) => {
      if (reviewerNumberOfReviews > 2) {
        acc.totalTrustedReviews++;
        if (rating === 5) {
          acc.reviewsScore++;
        }
        if (rating === 1) {
          acc.reviewsScore--;
        }
      }
      return acc;
    },
    { reviewsScore: 0, totalTrustedReviews: 0 }
  );

  const recentReviewScorePercentage = reviewsScore / totalTrustedReviews;

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

    const resetButton = document.createElement('button');
    resetButton.innerText = 'Reset';
    resetButton.onclick = () => {
      reviewMap = {};
      queueReviews();
    };
    recentReviewScoreElement.appendChild(resetButton);
  }

  reviewScoreAsPercentageElement.innerText = `${Math.round(
    reviewsScore * recentReviewScorePercentage
  )} - ${Math.round(recentReviewScorePercentage * 100)}%`;

  const trustedReviewsRatio = totalTrustedReviews / Object.keys(reviewMap).length;

  trustedReviewsElement.innerText = `${totalTrustedReviews} reviews trusted out of ${
    Object.keys(reviewMap).length
  } reviews`;

  applyColorsForElement(document.querySelector('#reviews-score'), recentReviewScorePercentage);
  applyColorsForElement(document.querySelector('#trusted-reviews'), trustedReviewsRatio);
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
      reviewMap = {};
    }

    queueReviews();
  } else {
    reviewMap = {};
    document.querySelector('#reviews-container')?.remove();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
