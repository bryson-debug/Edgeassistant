import {
  AIRTABLE_BASE_ID,
  CATALOG_TTL_MS,
  MASTERCLASSES_TABLE,
  RESOURCES_TABLE,
} from "./config";

export type ItemKind = "Resource" | "Workshop";

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  title: string;
  author: string;
  description: string;
  url: string;
}

export interface Catalog {
  items: Map<string, CatalogItem>;
  // Workshop record ID -> transcript. Server-only; never sent to Claude in
  // full or to the browser.
  transcripts: Map<string, string>;
  // Text block sent to Claude inside the cached prompt prefix. No URLs, no
  // transcripts.
  promptText: string;
  loadedAt: number;
}

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

let cached: Catalog | null = null;
let inFlight: Promise<Catalog> | null = null;

export async function getCatalog(): Promise<Catalog> {
  if (cached && Date.now() - cached.loadedAt < CATALOG_TTL_MS) return cached;
  if (!inFlight) {
    inFlight = loadCatalog()
      .then((catalog) => {
        cached = catalog;
        return catalog;
      })
      .catch((err) => {
        // Keep serving the last good catalog if Airtable has a hiccup.
        if (cached) {
          console.error("Airtable refresh failed; serving cached catalog:", errorMessage(err));
          return cached;
        }
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

async function loadCatalog(): Promise<Catalog> {
  const r = RESOURCES_TABLE.fields;
  const m = MASTERCLASSES_TABLE.fields;
  const [resources, workshops] = await Promise.all([
    fetchAllRecords(RESOURCES_TABLE.id, [r.title, r.author, r.description, r.url]),
    fetchAllRecords(MASTERCLASSES_TABLE.id, [m.title, m.presenter, m.description, m.url, m.transcript]),
  ]);

  const items = new Map<string, CatalogItem>();
  const transcripts = new Map<string, string>();

  for (const rec of resources) {
    const item = toItem(rec, "Resource", r.title, r.author, r.description, r.url);
    if (item) items.set(item.id, item);
  }
  for (const rec of workshops) {
    const item = toItem(rec, "Workshop", m.title, m.presenter, m.description, m.url);
    if (!item) continue;
    items.set(item.id, item);
    const transcript = asText(rec.fields[m.transcript]);
    if (transcript) transcripts.set(item.id, transcript);
  }

  return { items, transcripts, promptText: buildPromptText(items), loadedAt: Date.now() };
}

export function toItem(
  rec: AirtableRecord,
  kind: ItemKind,
  titleField: string,
  authorField: string,
  descriptionField: string,
  urlField: string,
): CatalogItem | null {
  const url = asText(rec.fields[urlField]);
  const title = asText(rec.fields[titleField]);
  // Records without a URL can't be linked, so they're left out entirely.
  if (!url || !title || !/^https?:\/\//i.test(url)) return null;
  return {
    id: rec.id,
    kind,
    title,
    author: asText(rec.fields[authorField]),
    description: asText(rec.fields[descriptionField]),
    url,
  };
}

// Sorted so the text is byte-identical between loads when nothing changed in
// Airtable; any difference would invalidate the prompt cache.
export function buildPromptText(items: Map<string, CatalogItem>): string {
  const sorted = [...items.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
  const lines = [`CATALOG (${sorted.length} items)`, ""];
  for (const item of sorted) {
    lines.push(`ID: ${item.id}`);
    lines.push(`Type: ${item.kind}`);
    lines.push(`Title: ${oneLine(item.title)}`);
    if (item.author) lines.push(`${item.kind === "Workshop" ? "Presenter" : "Author"}: ${oneLine(item.author)}`);
    if (item.description) lines.push(`Description: ${oneLine(stripUrls(item.description))}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function fetchAllRecords(tableId: string, fieldIds: string[]): Promise<AirtableRecord[]> {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) throw new Error("AIRTABLE_TOKEN is not set");

  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100", returnFieldsByFieldId: "true" });
    for (const f of fieldIds) params.append("fields[]", f);
    if (offset) params.set("offset", offset);
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Airtable ${tableId} responded ${res.status}`);
    const body = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    records.push(...body.records);
    offset = body.offset;
  } while (offset);
  return records;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (value && typeof value === "object" && "name" in value) return asText((value as { name: unknown }).name);
  return "";
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Descriptions are member-facing Markdown and may contain links. Claude must
// never see a URL it could copy, so strip them here too.
function stripUrls(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
