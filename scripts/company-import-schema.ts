import { z } from "zod";

export const companySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  city: z.string().min(1),
  address: z.string().min(1),
  rating: z.number().finite().min(0).max(5).nullable(),
  reviews_count: z.number().int().nonnegative(),
  site: z.string().nullable(),
  phone: z.string().nullable(),
});

export const companyPageSchema = z.object({
  page: z.number().int().positive(),
  per_page: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  items: z.array(z.unknown()),
});

export type Company = z.infer<typeof companySchema>;
