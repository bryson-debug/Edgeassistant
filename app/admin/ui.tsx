import Link from "next/link";
import { cardsOf, type ExchangeLog, type LoggedPart } from "@/lib/chat-log";

const TIME_ZONE = "America/New_York";

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  return usd < 0.01 && usd > 0 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function AdminHeader({ back }: { back?: boolean }) {
  return (
    <header className="admin-header">
      <div className="admin-title">
        {back ? (
          <Link href="/admin" className="back">
            ← All conversations
          </Link>
        ) : null}
        <h1>Assistant Admin</h1>
      </div>
      <form method="post" action="/admin/session">
        <input type="hidden" name="action" value="logout" />
        <button type="submit" className="btn ghost">
          Sign out
        </button>
      </form>
    </header>
  );
}

export function Flags({ noRecs, errors, dropped, rateLimited }: { noRecs: number; errors: number; dropped: number; rateLimited: number }) {
  return (
    <span className="flags">
      {noRecs > 0 && <span className="flag norec">No recommendation{noRecs > 1 ? ` ×${noRecs}` : ""}</span>}
      {errors > 0 && <span className="flag error">Error{errors > 1 ? ` ×${errors}` : ""}</span>}
      {dropped > 0 && <span className="flag error">Invalid ID dropped{dropped > 1 ? ` ×${dropped}` : ""}</span>}
      {rateLimited > 0 && <span className="flag limit">Rate limited{rateLimited > 1 ? ` ×${rateLimited}` : ""}</span>}
    </span>
  );
}

export function exchangeFlags(x: ExchangeLog) {
  return {
    noRecs: x.status === "ok" && cardsOf(x).length === 0 ? 1 : 0,
    errors: x.status === "error" ? 1 : 0,
    dropped: x.droppedIds.length,
    rateLimited: x.status === "rate_limited" ? 1 : 0,
  };
}

// Shows the reply as the member saw it: text with **bold**, then cards.
export function Reply({ parts }: { parts: LoggedPart[] }) {
  if (!parts.length) return <p className="muted">No reply was sent.</p>;
  return (
    <div className="reply">
      {parts.map((p, i) =>
        p.type === "text" ? (
          p.text.trim() ? (
            <p key={i} className="reply-text">
              {boldOnly(p.text.trim())}
            </p>
          ) : null
        ) : (
          <div key={i} className="reply-card">
            <span className={`label ${p.kind === "Workshop" ? "workshop" : "resource"}`}>{p.kind}</span>
            <strong>{p.title}</strong>
            {p.desc.trim() && <span className="muted">{boldOnly(p.desc.trim())}</span>}
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="url">
              {p.url}
            </a>
          </div>
        ),
      )}
    </div>
  );
}

function boldOnly(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((piece, i) =>
    /^\*\*[^*]+\*\*$/.test(piece) ? <strong key={i}>{piece.slice(2, -2)}</strong> : piece,
  );
}
