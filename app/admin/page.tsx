import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { getLogStore, isNoRec, monthKey, replyText, type DayStats, type ExchangeLog } from "@/lib/chat-log";
import { AdminHeader, exchangeFlags, Flags, formatCost, formatTime } from "./ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const SEARCH_DEPTH = 2000;
const FILTERS = {
  all: "All",
  norec: "No recommendation",
  errors: "Errors or invalid IDs",
  limited: "Rate limited",
} as const;
type Filter = keyof typeof FILTERS;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; filter?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const q = (params.q ?? "").trim().slice(0, 200);
  const filter: Filter = params.filter && params.filter in FILTERS ? (params.filter as Filter) : "all";
  const searching = q !== "" || filter !== "all";

  const store = getLogStore();
  const now = new Date();
  const [days, top, conversations, recent] = await Promise.all([
    store.dailyStats(30, now),
    store.topItems(monthKey(now)),
    searching ? null : store.listConversations((page - 1) * PAGE_SIZE, PAGE_SIZE),
    searching ? store.recentExchanges(SEARCH_DEPTH) : null,
  ]);

  const matches = recent?.filter((x) => matchesFilter(x, filter) && matchesQuery(x, q)) ?? [];
  const totalPages = conversations ? Math.max(1, Math.ceil(conversations.total / PAGE_SIZE)) : 1;

  return (
    <main className="admin-main">
      <AdminHeader />

      <section aria-labelledby="overview">
        <h2 id="overview">Overview</h2>
        <div className="tiles">
          <Tile label="Messages, last 7 days" value={sum(days.slice(0, 7), "messages").toLocaleString()} />
          <Tile label="Messages, last 30 days" value={sum(days, "messages").toLocaleString()} />
          <Tile label="Conversations, last 30 days" value={sum(days, "conversations").toLocaleString()} />
          <Tile label="Claude cost, last 30 days" value={formatCost(sum(days, "costUsd"))} />
          <Tile
            label="No recommendation, last 30 days"
            value={percent(sum(days, "noRecs"), sum(days, "messages"))}
            hint="Often a catalog gap worth reviewing"
          />
        </div>
        <p className="muted small">
          Dates are Eastern time. Export:{" "}
          {[30, 90, 365].map((d, i) => (
            <span key={d}>
              {i > 0 && " · "}
              <a href={`/admin/export?days=${d}`}>last {d} days (CSV)</a>
            </span>
          ))}
        </p>
      </section>

      <div className="two-col">
        <section aria-labelledby="daily">
          <h2 id="daily">Last 14 days</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="num">Messages</th>
                  <th scope="col" className="num">Conversations</th>
                  <th scope="col" className="num">No rec.</th>
                  <th scope="col" className="num">Errors</th>
                  <th scope="col" className="num">Rate limited</th>
                  <th scope="col" className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {days.slice(0, 14).map((d) => (
                  <tr key={d.day}>
                    <th scope="row">{d.day}</th>
                    <td className="num">{d.messages}</td>
                    <td className="num">{d.conversations}</td>
                    <td className="num">{d.noRecs}</td>
                    <td className="num">{d.errors}</td>
                    <td className="num">{d.rateLimited}</td>
                    <td className="num">{formatCost(d.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="top">
          <h2 id="top">Most recommended this month</h2>
          {top.length ? (
            <ol className="top-list">
              {top.slice(0, 10).map((t) => (
                <li key={t.id}>
                  <span>{t.title}</span>
                  <span className="num muted">{t.count}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Nothing recommended yet this month.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="convos">
        <h2 id="convos">{searching ? "Matching messages" : "Conversations"}</h2>
        <form className="filters" method="get" action="/admin">
          <label htmlFor="q" className="sr-only">
            Search questions and replies
          </label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Search questions and replies" />
          <label htmlFor="filter" className="sr-only">
            Show
          </label>
          <select id="filter" name="filter" defaultValue={filter}>
            {Object.entries(FILTERS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn primary">
            Apply
          </button>
          {searching && (
            <Link href="/admin" className="btn ghost">
              Clear
            </Link>
          )}
        </form>

        {searching ? (
          <>
            <p className="muted small">
              {matches.length} match{matches.length === 1 ? "" : "es"} in the latest {SEARCH_DEPTH.toLocaleString()} messages.
            </p>
            <ul className="rows">
              {matches.map((x) => (
                <li key={x.id}>
                  <Link href={`/admin/c/${encodeURIComponent(x.conversationId)}#${x.id}`} className="row">
                    <span className="row-main">
                      <span className="question">{x.question}</span>
                      <span className="muted snippet">{snippet(x)}</span>
                    </span>
                    <span className="row-meta">
                      <span className="muted small">{formatTime(x.at)}</span>
                      <Flags {...exchangeFlags(x)} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : conversations && conversations.items.length ? (
          <>
            <ul className="rows">
              {conversations.items.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/c/${encodeURIComponent(c.id)}`} className="row">
                    <span className="row-main">
                      <span className="question">{c.firstQuestion || "(no question)"}</span>
                      <span className="muted small">
                        {c.messages} message{c.messages === 1 ? "" : "s"} · visitor {c.visitor} · {formatCost(c.costUsd)}
                      </span>
                    </span>
                    <span className="row-meta">
                      <span className="muted small">{formatTime(c.lastAt)}</span>
                      <Flags noRecs={c.noRecs} errors={c.errors} dropped={c.dropped} rateLimited={c.rateLimited} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <nav className="pager" aria-label="Pages">
              {page > 1 ? <Link href={`/admin?page=${page - 1}`}>← Newer</Link> : <span />}
              <span className="muted small">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? <Link href={`/admin?page=${page + 1}`}>Older →</Link> : <span />}
            </nav>
          </>
        ) : (
          <p className="muted">No conversations yet.</p>
        )}
      </section>
    </main>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
      {hint && <span className="tile-hint">{hint}</span>}
    </div>
  );
}

function sum(days: DayStats[], key: Exclude<keyof DayStats, "day">): number {
  return days.reduce((n, d) => n + d[key], 0);
}

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

function matchesFilter(x: ExchangeLog, filter: Filter): boolean {
  if (filter === "norec") return isNoRec(x);
  if (filter === "errors") return x.status === "error" || x.droppedIds.length > 0;
  if (filter === "limited") return x.status === "rate_limited";
  return true;
}

function matchesQuery(x: ExchangeLog, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return x.question.toLowerCase().includes(needle) || replyText(x.parts).toLowerCase().includes(needle);
}

function snippet(x: ExchangeLog): string {
  const text = replyText(x.parts).replace(/\*\*/g, "").replace(/\s+/g, " ");
  return text.length > 180 ? `${text.slice(0, 177)}…` : text || "No reply";
}
