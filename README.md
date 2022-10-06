# Summarize Google maps reviews extension

Summarizes Google Maps reviews into a simple percentage "quality" score, discarding reviews by accounts with less than 3 reviews (possibly fake accounts).

Runs on the Google Maps review page for any given place.

## Algorithm

1. discard reviews by accounts with less than 3 reviews
2. Score = (number of 5 star reviews - number of 1 star reviews)/(number of reviews)
3. This means 5 star reviews are incentivized, 1 star reviews are penalized, and the rest of the reviews are not counted as they don't give enough signal. The resulting percentage is a good indicator (but not perfect) of the quality of the place, without you needing to read all the reviews yourself.
