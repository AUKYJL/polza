export function getQueryParam(value: string | string[] | undefined): string {
  return Array.isArray(value)
    ? (value[0]?.trim() ?? "")
    : (value?.trim() ?? "");
}
