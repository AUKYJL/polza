"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

import type { CompaniesResponse } from "@/features/companies/types";

const ALL_CITIES = "__all_cities__";

export function CompaniesTable({
  initialSearch,
  initialCity,
  initialPage,
}: {
  initialSearch: string;
  initialCity: string;
  initialPage: number;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [city, setCity] = useState(initialCity);
  const [page, setPage] = useState(initialPage);
  const [data, setData] = useState<CompaniesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);
  const queryString = createQueryString(debouncedSearch, city, page);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 300);

    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const nextQueryString = createQueryString(search, city, page);
    const nextUrl = `/companies${nextQueryString ? `?${nextQueryString}` : ""}`;

    window.history.replaceState(window.history.state, "", nextUrl);
  }, [search, city, page]);

  useEffect(() => {
    const controller = new AbortController();

    void loadCompanies(queryString, controller.signal)
      .then((response) => {
        setData(response);
        setError(null);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError("Не удалось загрузить компании. Попробуйте ещё раз.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [queryString, reloadVersion]);

  const retry = useCallback(() => {
    setReloadVersion((version) => version + 1);
    setIsLoading(true);
    setError(null);
  }, []);

  const resetFilters = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setCity("");
    setPage(1);
    setError(null);
  }, []);

  const updateSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
    setError(null);
  }, []);

  const updateCity = useCallback((value: string) => {
    setCity(value === ALL_CITIES ? "" : value);
    setPage(1);
    setError(null);
  }, []);

  const cities = data?.cities ?? [];

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Компании</h1>
        <p className="text-muted-foreground">Поиск компаний по названию и городу.</p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem_auto]">
        <label className="grid gap-1.5 text-sm font-medium">
          Название
          <Input
            name="search"
            placeholder="Поиск по названию"
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
          />
        </label>
        <div className="grid gap-1.5 text-sm font-medium">
          <label htmlFor="company-city">Город</label>
          <Select value={city || ALL_CITIES} onValueChange={updateCity}>
            <SelectTrigger id="company-city" className="w-full">
              <SelectValue placeholder="Все города" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CITIES}>Все города</SelectItem>
              {cities.map((cityOption) => (
                <SelectItem key={cityOption} value={cityOption}>
                  {cityOption}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button type="button" variant="outline" onClick={resetFilters}>
            Сбросить
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p>{error}</p>
          <Button className="mt-3" type="button" variant="outline" onClick={retry}>
            Повторить
          </Button>
        </div>
      ) : isLoading && !data ? (
        <LoadingTable />
      ) : data && data.companies.length === 0 ? (
        <p className="rounded-lg border p-6 text-sm text-muted-foreground">Ничего не найдено.</p>
      ) : data ? (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Категория</TableHead>
                <TableHead>Город</TableHead>
                <TableHead>Адрес</TableHead>
                <TableHead>Рейтинг</TableHead>
                <TableHead>Отзывы</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.companies.map((company) => (
                <TableRow key={company.sourceId}>
                  <TableCell className="font-medium">{company.name}</TableCell>
                  <TableCell>{company.category}</TableCell>
                  <TableCell>{company.city}</TableCell>
                  <TableCell className="whitespace-normal">{company.address}</TableCell>
                  <TableCell>{company.rating ?? "—"}</TableCell>
                  <TableCell>{company.reviewsCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end border-t p-3">
            <div className="flex items-center gap-1">
              <Button
                aria-label="Предыдущая страница"
                disabled={page === 1}
                size="icon"
                type="button"
                variant="outline"
                onClick={() => setPage((currentPage) => currentPage - 1)}
              >
                <ChevronLeft />
              </Button>
              <span className="flex size-8 items-center justify-center rounded-lg border bg-background text-sm" aria-current="page">
                {page}
              </span>
              <Button
                aria-label="Следующая страница"
                disabled={!data.hasNext}
                size="icon"
                type="button"
                variant="outline"
                onClick={() => setPage((currentPage) => currentPage + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

async function loadCompanies(queryString: string, signal: AbortSignal): Promise<CompaniesResponse> {
  const response = await fetch(`/api/companies${queryString ? `?${queryString}` : ""}`, { signal });

  if (!response.ok) throw new Error("Unable to load companies");

  return (await response.json()) as CompaniesResponse;
}

function createQueryString(search: string, city: string, page: number) {
  const params = new URLSearchParams();

  if (search) params.set("search", search);
  if (city) params.set("city", city);
  if (page > 1) params.set("page", String(page));

  return params.toString();
}

function LoadingTable() {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}
