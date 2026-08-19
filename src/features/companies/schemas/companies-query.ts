import { z } from "zod";

import type { CompaniesQuery } from "@/features/companies/types";

const filterValueSchema = z
  .string()
  .trim()
  .transform((value) => value || undefined);

const pageSchema = z.coerce.number().int().positive().default(1);

const companiesQuerySchema = z.object({
  search: filterValueSchema.optional(),
  city: filterValueSchema.optional(),
  page: pageSchema,
});

export function parseCompaniesQuery(searchParams: URLSearchParams):
  | { success: true; data: CompaniesQuery }
  | { success: false; message: string } {
  for (const key of ["search", "city", "page"]) {
    if (searchParams.getAll(key).length > 1) {
      return { success: false, message: `Query parameter "${key}" must not be repeated` };
    }
  }

  const result = companiesQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    city: searchParams.get("city") ?? undefined,
    page: searchParams.get("page") ?? undefined,
  });

  if (!result.success) {
    return { success: false, message: result.error.issues[0]?.message ?? "Invalid query parameters" };
  }

  return { success: true, data: result.data };
}
