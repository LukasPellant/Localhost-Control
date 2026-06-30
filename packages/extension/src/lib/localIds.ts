export const slugifyLocalId = (value: string, fallback = "project"): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || fallback;

export const uniqueLocalId = (value: string, existingIds: Iterable<string>, fallback = "project"): string => {
  const baseId = slugifyLocalId(value, fallback);
  const seenIds = new Set(existingIds);
  let id = baseId;
  let suffix = 2;
  while (seenIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
};
