import { getDbPool } from "@/shared/lib/db";

import type { CompaniesQuery, CompaniesResponse, CompanyListItem } from "@/features/companies/types";

type CompanyRow = {
  source_id: string;
  name: string;
  category: string;
  city: string;
  address: string;
  rating: string | null;
  reviews_count: number;
};

type CityRow = {
  city: string;
};

const PAGE_SIZE = 100;

export async function getCompanies(query: CompaniesQuery): Promise<CompaniesResponse> {
  const values: Array<string | number> = [];
  const filters: string[] = [];

  if (query.search) {
    values.push(query.search);
    filters.push(`name COLLATE "und-x-icu" ILIKE '%' || $${values.length} || '%'`);
  }

  if (query.city) {
    values.push(query.city);
    filters.push(`city = $${values.length}`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  values.push((query.page - 1) * PAGE_SIZE);
  const offsetParameter = `$${values.length}`;
  const pool = getDbPool();
  const [companiesResult, citiesResult] = await Promise.all([
    pool.query<CompanyRow>(
      `
        SELECT source_id, name, category, city, address, rating, reviews_count
        FROM companies
        ${whereClause}
        ORDER BY name ASC, source_id ASC
        LIMIT ${PAGE_SIZE + 1}
        OFFSET ${offsetParameter}
      `,
      values,
    ),
    pool.query<CityRow>("SELECT DISTINCT city FROM companies ORDER BY city ASC"),
  ]);

  return {
    companies: companiesResult.rows.slice(0, PAGE_SIZE).map(mapCompanyRow),
    cities: citiesResult.rows.map(({ city }) => city),
    hasNext: companiesResult.rows.length > PAGE_SIZE,
  };
}

function mapCompanyRow(row: CompanyRow): CompanyListItem {
  return {
    sourceId: row.source_id,
    name: row.name,
    category: row.category,
    city: row.city,
    address: row.address,
    rating: row.rating === null ? null : Number(row.rating),
    reviewsCount: row.reviews_count,
  };
}
