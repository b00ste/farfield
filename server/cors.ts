/** Browser-origin restriction complements bearer capabilities; CLI clients have no Origin. */
export function allowedOrigins(value = ""): Set<string> | null {
  if (!value.trim()) return null;
  return new Set(
    value.split(",").map((entry) => {
      const origin = entry.trim();
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
        throw new Error(
          "FARFIELD_ALLOWED_ORIGINS must contain comma-separated http(s) origins.",
        );
      return origin;
    }),
  );
}

export function corsOrigin(
  origin: string | undefined,
  allowed: Set<string> | null,
): string | null {
  if (!allowed) return "*";
  if (!origin) return null;
  return allowed.has(origin) ? origin : null;
}
