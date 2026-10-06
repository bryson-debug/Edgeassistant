import type { CatalogItem, ItemKind } from "./catalog";

export type ReplyPart =
  | { type: "text"; text: string }
  | { type: "card"; id: string; kind: ItemKind; title: string; url: string }
  | { type: "desc"; text: string };

const ALLOWED_MAILTO = "mailto:hello@thatmusicteacher.com";
const TOKEN_SPLIT = /(\{\{[^{}]{0,40}\}\})/;
const TOKEN_EXACT = /^\{\{\s*([^{}\s]*)\s*\}\}$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.([a-z]{2,})(\/\S*)?$/i;
const COMMON_TLDS = new Set(
  "com org net edu gov io co us me ly gl app ai info tv ca uk au link site page dev".split(" "),
);

/**
 * Turns Claude's streamed text into safe reply parts:
 * - {{recXXXXXXXXXXXXXX}} tokens become resource cards built from Airtable
 *   data. Unknown IDs are dropped and reported through onUnknownId.
 * - The sentence after a token becomes that card's description.
 * - Any URL Claude writes itself is removed, except the support mailto.
 *
 * Text is held back until a whitespace boundary so a URL or token is never
 * split across two chunks.
 */
export class ReplyFilter {
  private buffer = "";
  private mode: "text" | "desc" = "text";
  private descHasText = false;

  constructor(
    private readonly lookup: (id: string) => CatalogItem | undefined,
    private readonly onUnknownId: (id: string) => void,
  ) {}

  push(delta: string): ReplyPart[] {
    this.buffer += delta;
    let cut = lastWhitespace(this.buffer);
    const open = this.buffer.lastIndexOf("{{");
    if (open > this.buffer.lastIndexOf("}}") && this.buffer.length - open < 60) {
      cut = Math.min(cut, open - 1);
    }
    if (cut < 0) return [];
    const ready = this.buffer.slice(0, cut + 1);
    this.buffer = this.buffer.slice(cut + 1);
    return this.process(ready);
  }

  flush(): ReplyPart[] {
    const rest = this.buffer;
    this.buffer = "";
    return this.process(rest);
  }

  private process(chunk: string): ReplyPart[] {
    const out: ReplyPart[] = [];
    for (const piece of chunk.split(TOKEN_SPLIT)) {
      if (!piece) continue;
      const token = TOKEN_EXACT.exec(piece);
      if (token) {
        const item = this.lookup(token[1]);
        if (item) {
          out.push({ type: "card", id: item.id, kind: item.kind, title: item.title, url: item.url });
          this.mode = "desc";
          this.descHasText = false;
        } else {
          this.onUnknownId(token[1]);
        }
        continue;
      }
      this.routeText(sanitizeText(piece), out);
    }
    return mergeParts(out);
  }

  private routeText(text: string, out: ReplyPart[]) {
    let rest = text;
    while (rest) {
      if (this.mode === "text") {
        out.push({ type: "text", text: rest });
        return;
      }
      if (!this.descHasText) {
        rest = rest.replace(/^\s+/, "");
        if (!rest) return;
      }
      const newline = rest.indexOf("\n");
      if (newline < 0) {
        out.push({ type: "desc", text: rest });
        this.descHasText = true;
        return;
      }
      out.push({ type: "desc", text: rest.slice(0, newline) });
      this.mode = "text";
      rest = rest.slice(newline);
    }
  }
}

function lastWhitespace(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (/\s/.test(text[i])) return i;
  }
  return -1;
}

export function sanitizeText(text: string): string {
  return text
    .split(/(\s+)/)
    .map((piece) => (/^\s*$/.test(piece) ? piece : sanitizeWord(piece)))
    .join("");
}

function sanitizeWord(word: string): string {
  let w = word;
  // Markdown link residue: "text](https://...)" -> "text"
  w = w.replace(/\]\([^)\s]*\)?/g, "");
  if (w.startsWith("[")) w = w.slice(1);
  // Leftover braces from a malformed or overlong token.
  if (/^\{\{?rec[A-Za-z0-9]*\}?\}?[.,;:!?]*$/.test(w)) return "";
  w = w.replace(/\{\{|\}\}/g, "");

  const lead = /^[("'<]*/.exec(w)?.[0] ?? "";
  const trail = /[.,;:!?)"'>]*$/.exec(w.slice(lead.length))?.[0] ?? "";
  const core = w.slice(lead.length, w.length - trail.length);
  if (!core) return w;

  if (/^mailto:/i.test(core)) {
    return core.toLowerCase() === ALLOWED_MAILTO ? w : lead + trail;
  }
  if (URL_SCHEME.test(core) || /^www\./i.test(core)) return lead + trail;
  if (!core.includes("@")) {
    const domain = BARE_DOMAIN.exec(core);
    if (domain && (domain[2] || COMMON_TLDS.has(domain[1].toLowerCase()))) return lead + trail;
  }
  return w;
}

export function mergeParts(parts: ReplyPart[]): ReplyPart[] {
  const merged: ReplyPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (part.type !== "card" && last && last.type !== "card" && last.type === part.type) {
      last.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}
