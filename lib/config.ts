// Airtable IDs come from the Airtable metadata API (base schema) so that
// renaming a field or table in Airtable doesn't break the assistant.
export const AIRTABLE_BASE_ID = "appqNfq390NUKfoD9";

export const RESOURCES_TABLE = {
  id: "tblfv9O12iOE64c27",
  fields: {
    title: "flde0kqTRkKjuRgHV", // Resource Name [PUBLIC]
    author: "fldwGBIcQNWQPZSWI", // Resource Author [PUBLIC]
    description: "fldNKvgQGxl3aXTEC", // Resource Description [PUBLIC]
    url: "fld9TaafIJVxvXuGO", // Logged-In URL [INTERNAL]
  },
} as const;

export const MASTERCLASSES_TABLE = {
  id: "tbl5hYAtgcLSKKSE1",
  fields: {
    title: "fldBEZXj2ZKfcrjbY", // Workshop Title [PUBLIC]
    presenter: "fld7hBNxK6lbMsX5B", // Clinician Name [PUBLIC]
    description: "fldK1WsWwG8oTFeWd", // Session Description [PUBLIC]
    url: "fld8xqw1puH7jAs8F", // Logged-In URL [INTERNAL]
    transcript: "fld6obdd1pBzYkTP8", // Workshop Transcript [INTERNAL]
  },
} as const;

export const CATALOG_TTL_MS = 5 * 60 * 1000;

export const DEFAULT_MODEL = "claude-haiku-4-5";
export const MAX_USER_MESSAGE_CHARS = 1000;
export const MAX_REPLY_TOKENS = 800;
export const HISTORY_MESSAGES = 10;
export const MAX_TOOL_ROUNDS = 3;

export const SUPPORT_EMAIL = "hello@thatmusicteacher.com";

export function getModel(): string {
  return process.env.MODEL?.trim() || DEFAULT_MODEL;
}

// Parses ALLOWED_PARENT_ORIGINS into a clean list of origins. Anything that
// isn't a bare http(s) origin is dropped so it can't widen the CSP.
export function getAllowedParentOrigins(): string[] {
  const raw = process.env.ALLOWED_PARENT_ORIGINS ?? "";
  const origins: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "http:") && url.origin === value.replace(/\/$/, "")) {
        origins.push(url.origin);
      }
    } catch {
      // ignore malformed entries
    }
  }
  return origins;
}
