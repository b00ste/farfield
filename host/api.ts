/** Public API origin is fixed at build time; the SDK sandbox never chooses it. */
export function apiUrl(
  path: string,
  origin?: string,
  pageOrigin?: string,
): string {
  const configured =
    origin ??
    (typeof __FARFIELD_API_ORIGIN__ === "undefined"
      ? ""
      : __FARFIELD_API_ORIGIN__);
  if (!path.startsWith("/api/") || path.includes("..") || path.includes("\\"))
    throw new Error("Invalid API path.");
  return new URL(path, configured || pageOrigin || location.origin).href;
}
