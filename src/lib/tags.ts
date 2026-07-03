export function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const clean = tags
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40))
    .filter(Boolean);
  return [...new Set(clean)].slice(0, 30);
}
