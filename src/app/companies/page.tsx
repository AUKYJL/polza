import { CompaniesTable } from "@/features/companies/ui/companies-table";
import { getQueryParam } from "@/shared/lib/get-query-param";

export default async function CompaniesPage({
  searchParams,
}: PageProps<"/companies">) {
  const params = await searchParams;

  return (
    <CompaniesTable
      initialSearch={getQueryParam(params.search)}
      initialCity={getQueryParam(params.city)}
      initialPage={getPageParam(params.page)}
    />
  );
}

function getPageParam(value: string | string[] | undefined): number {
  const page = Number(getQueryParam(value));

  return Number.isInteger(page) && page > 0 ? page : 1;
}
