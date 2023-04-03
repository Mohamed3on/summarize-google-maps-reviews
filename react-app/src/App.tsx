import { useState } from 'react';
import './App.css';
import { useMutationObserver } from './useMutationObserver';

let lastPlaceName = location.href.match(/(?:place\/)([^/]+)/)?.[1];

const parseReviews = (reviews: HTMLElement[]) => {
  const reviewMap = {};
  Array.from(reviews).forEach((review) => {
    const reviewId = review.getAttribute('data-review-id') || 'null';

    if (reviewMap[reviewId]) {
      return;
    }

    let rating;

    try {
      rating = review
        ?.querySelector('[role="img"].kvMYJc')
        ?.getAttribute('aria-label')
        ?.match(/(\d)(?<!stars)/)?.[0];
      // for hotels, the rating format is different (4/5)
    } catch (e) {
      rating = (review?.querySelector('span.fzvQIb') as HTMLElement)?.innerText.match(/\d/)?.[0];
    }

    const reviewerNumberOfReviews =
      (review.querySelector('.RfnDt > span:nth-child(2)') as HTMLElement)?.innerText.match(
        /(\d+)/
      )?.[0] || '1';

    const IsReviewYoungerThanAYear = !(
      review.querySelector('.rsqaWe') as HTMLElement
    )?.innerText.match(/year/);
    const isReviewYoungerThanAMonth =
      IsReviewYoungerThanAYear &&
      !(review.querySelector('.rsqaWe') as HTMLElement)?.innerText.match(/month/);

    reviewMap[reviewId] = {
      rating: parseInt(rating),
      reviewerNumberOfReviews: parseInt(reviewerNumberOfReviews),
      inPastYear: IsReviewYoungerThanAYear,
      inPastMonth: isReviewYoungerThanAMonth,
    };
  });

  return reviewMap;
};
const getNewReviews = (reviewMap) => {
  const reviews = document.querySelectorAll('.jftiEf.fontBodyMedium') as NodeListOf<HTMLElement>;
  const newReviews = Array.from(reviews).filter(
    (review) => !reviewMap[review.getAttribute('data-review-id') || 'null']
  );

  if (newReviews.length) {
    console.log('new reviews', newReviews.length);
    return parseReviews(newReviews);
  }
};

function App() {
  const [reviewMap, setReviewMap] = useState({});

  const callback = () => {
    let placeName = location.href.match(/(?:place\/)([^/]+)/)?.[1];

    const reviews = document.querySelectorAll('.jftiEf.fontBodyMedium');
    if (reviews.length > 4) {
      if (placeName !== lastPlaceName) {
        lastPlaceName = placeName;
        setReviewMap({});
      }

      const newReviews = getNewReviews(reviewMap);
      if (newReviews) {
        setReviewMap({ ...reviewMap, ...newReviews });
      }
    } else {
      setReviewMap({});
    }
  };

  useMutationObserver(document.body, callback);
  return <div className='App'>{JSON.stringify(reviewMap)}</div>;
}

export default App;
