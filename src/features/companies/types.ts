export type CompanyListItem = {
  sourceId: string;
  name: string;
  category: string;
  city: string;
  address: string;
  rating: number | null;
  reviewsCount: number;
};

export type CompaniesResponse = {
  companies: CompanyListItem[];
  cities: string[];
  hasNext: boolean;
};

export type CompaniesQuery = {
  search?: string;
  city?: string;
  page: number;
};
