// Pure header-merge helper for the Firefox webRequest injector — no browser/DOM imports, so it's
// unit-testable in isolation. Case-insensitive upsert: overwrite the value if the header is already
// present, else append it. Empty/undefined values are a no-op (we never inject a blank header).

export type WebRequestHeader = { name: string; value?: string };

export function upsertHeader(headers: WebRequestHeader[], name: string, value?: string): void {
  if (!value) return;
  const existing = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  if (existing) existing.value = value;
  else headers.push({ name, value });
}
