-- 1. Top 5 categories by number of companies.
SELECT
  category,
  COUNT(*) AS company_count
FROM companies
GROUP BY category
ORDER BY company_count DESC, category ASC
LIMIT 5;

-- 2. Average rating by city for companies with at least 10 reviews.
-- Companies without a rating are excluded rather than treated as zero.
SELECT
  city,
  AVG(rating) AS average_rating
FROM companies
WHERE reviews_count >= 10
  AND rating IS NOT NULL
GROUP BY city
ORDER BY average_rating DESC, city ASC;

-- 3. Share of companies with a non-blank website, grouped by category.
SELECT
  category,
  COUNT(*) FILTER (WHERE NULLIF(BTRIM(site), '') IS NOT NULL) AS companies_with_website,
  COUNT(*) AS company_count,
  100.0 * COUNT(*) FILTER (WHERE NULLIF(BTRIM(site), '') IS NOT NULL) / COUNT(*) AS website_share_percent
FROM companies
GROUP BY category
ORDER BY category ASC;
