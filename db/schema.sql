CREATE TABLE IF NOT EXISTS companies (
  source_id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  city text NOT NULL,
  address text NOT NULL,
  rating numeric,
  reviews_count integer NOT NULL,
  site text,
  phone text,
  CONSTRAINT companies_rating_range_check CHECK (rating BETWEEN 0 AND 5),
  CONSTRAINT companies_reviews_count_nonnegative_check CHECK (reviews_count >= 0)
);
