import { getCompanies } from "@/features/companies/api/get-companies";
import { parseCompaniesQuery } from "@/features/companies/schemas/companies-query";

export async function GET(request: Request) {
  const query = parseCompaniesQuery(new URL(request.url).searchParams);

  if (!query.success) {
    return Response.json(
      { error: { code: "INVALID_QUERY", message: query.message } },
      { status: 400 },
    );
  }

  try {
    return Response.json(await getCompanies(query.data));
  } catch (error) {
    console.error("Failed to load companies", error);

    return Response.json(
      { error: { code: "COMPANIES_UNAVAILABLE", message: "Unable to load companies" } },
      { status: 500 },
    );
  }
}
