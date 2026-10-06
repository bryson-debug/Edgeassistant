import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { CONVERSATION_ID, getLogStore } from "@/lib/chat-log";
import { AdminHeader, exchangeFlags, Flags, formatCost, formatTime, Reply } from "../../ui";

export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!CONVERSATION_ID.test(id)) notFound();
  const exchanges = await getLogStore().getConversation(id);
  if (!exchanges.length) notFound();

  const total = exchanges.reduce((n, x) => n + (Number.isFinite(x.costUsd) ? (x.costUsd ?? 0) : 0), 0);

  return (
    <main className="admin-main">
      <AdminHeader back />
      <section>
        <h2>Conversation</h2>
        <p className="muted small">
          Started {formatTime(exchanges[0].at)} · visitor {exchanges[0].visitor} · {exchanges.length} message
          {exchanges.length === 1 ? "" : "s"} · {formatCost(total)} · ID {id}
        </p>
      </section>

      <ol className="exchanges">
        {exchanges.map((x) => (
          <li key={x.id} id={x.id} className="exchange">
            <div className="exchange-head">
              <span className="muted small">{formatTime(x.at)}</span>
              <Flags {...exchangeFlags(x)} />
            </div>
            <p className="asked">
              <span className="who">Member</span>
              {x.question}
            </p>
            <div className="answered">
              <span className="who">Assistant</span>
              {x.status === "rate_limited" ? <p className="muted">Blocked by the rate limit; no reply generated.</p> : <Reply parts={x.parts} />}
            </div>
            <dl className="details">
              {x.searches.map((s, i) => (
                <div key={i}>
                  <dt>Transcript search</dt>
                  <dd>
                    “{s.query}” → {s.ids.length ? s.ids.join(", ") : "no matches"}
                  </dd>
                </div>
              ))}
              {x.droppedIds.length > 0 && (
                <div>
                  <dt>Invalid IDs dropped</dt>
                  <dd>{x.droppedIds.join(", ")}</dd>
                </div>
              )}
              {x.tokens && (
                <div>
                  <dt>Usage</dt>
                  <dd>
                    {x.model} · {x.tokens.input.toLocaleString()} in, {x.tokens.cacheRead.toLocaleString()} cached,{" "}
                    {x.tokens.cacheWrite.toLocaleString()} cache write, {x.tokens.output.toLocaleString()} out ·{" "}
                    {formatCost(x.costUsd ?? NaN)}
                    {x.durationMs ? ` · ${(x.durationMs / 1000).toFixed(1)}s` : ""}
                  </dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ol>
    </main>
  );
}
