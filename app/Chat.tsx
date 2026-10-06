"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Kind = "Resource" | "Workshop";
type Part =
  | { type: "text"; text: string }
  | { type: "card"; id: string; kind: Kind; title: string; url: string; desc: string };
type Message = { role: "user"; text: string } | { role: "assistant"; parts: Part[]; error?: boolean };
type StreamEvent =
  | { type: "text"; text: string }
  | { type: "card"; id: string; kind: Kind; title: string; url: string }
  | { type: "desc"; text: string }
  | { type: "error"; text: string };

const STORAGE_KEY = "edge-assistant-chat-v1";
const MAX_CHARS = 1000;
const HISTORY_SENT = 10;
const SUPPORT_EMAIL = "hello@thatmusicteacher.com";
const GREETING =
  "Hi! I'm here to help you find the perfect Elementary Music EDGE resources, workshops, and lesson planning menus. What are you looking for today?";
const STARTERS = [
  "This month's lesson planning menu",
  "Classroom management help",
  "Starting ukulele or recorders",
  "Sub plans",
];
const NETWORK_ERROR = `Sorry, I couldn't reach the assistant. Please check your connection and try again, or email ${SUPPORT_EMAIL} if it keeps happening.`;

type FrameState = "checking" | "ok" | "blocked";

export default function Chat({ allowedParentOrigins }: { allowedParentOrigins: string[] }) {
  const [frame, setFrame] = useState<FrameState>("checking");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // Only run inside an iframe on an allowed parent. The CSP header already
  // stops other sites from framing the page; this covers opening it directly.
  useEffect(() => {
    let framed = true;
    try {
      framed = window.self !== window.top;
    } catch {
      framed = true;
    }
    let allowed = framed;
    const ancestors = window.location.ancestorOrigins;
    if (framed && ancestors && ancestors.length > 0) {
      allowed = allowedParentOrigins.includes(ancestors[0]);
    }
    setFrame(allowed ? "ok" : "blocked");
  }, [allowedParentOrigins]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setMessages(parsed.filter(isMessage));
      }
    } catch {
      // storage unavailable or corrupt: start fresh
    }
  }, []);

  useEffect(() => {
    if (busy) return;
    try {
      if (messages.length) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [messages, busy]);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useLayoutEffect(() => {
    if (stickToBottom.current) scrollToBottom(false);
  }, [messages, waiting, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 80;
    setShowJump(distance > 160);
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy || text.length > MAX_CHARS) return;

    const next: Message[] = [...messages, { role: "user", text }];
    setMessages([...next, { role: "assistant", parts: [] }]);
    setInput("");
    setBusy(true);
    setWaiting(true);
    stickToBottom.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    const update = (fn: (parts: Part[]) => Part[], error = false) =>
      setMessages((current) => {
        const copy = current.slice();
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") copy[copy.length - 1] = { ...last, parts: fn(last.parts), error: error || last.error };
        return copy;
      });
    const fail = (message: string) => {
      setWaiting(false);
      update(() => [{ type: "text", text: message }], true);
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toApiHistory(next) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        fail(typeof body?.error === "string" ? body.error : NETWORK_ERROR);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          setWaiting(false);
          if (event.type === "error") update((parts) => [...parts, { type: "text", text: `\n\n${event.text}` }], true);
          else update((parts) => applyEvent(parts, event));
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") fail(NETWORK_ERROR);
    } finally {
      abortRef.current = null;
      setWaiting(false);
      setBusy(false);
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last?.role === "assistant" && !last.parts.some(hasContent)) {
          return [...current.slice(0, -1), { role: "assistant", parts: [{ type: "text", text: NETWORK_ERROR }], error: true }];
        }
        return current;
      });
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    setShowJump(false);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    inputRef.current?.focus();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  if (frame === "checking") return <div className="shell" aria-busy="true" />;
  if (frame === "blocked") {
    return (
      <main className="blocked">
        <img src="/avatar-placeholder.svg" alt="" width={56} height={56} />
        <h1>Elementary Music EDGE Assistant</h1>
        <p>Please open the assistant from the Elementary Music EDGE member area.</p>
      </main>
    );
  }

  const tooLong = input.length > MAX_CHARS;
  const lastIndex = messages.length - 1;

  return (
    <div className="shell">
      <header className="header">
        <Avatar />
        <h1 className="brand">Elementary Music EDGE Assistant</h1>
        <button type="button" className="new-chat" onClick={newChat}>
          New chat
        </button>
      </header>

      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="log" role="log" aria-live="polite" aria-relevant="additions">
          <div className="msg assistant">
            <p className="text">{GREETING}</p>
          </div>
          {messages.length === 0 && (
            <div className="chips" aria-label="Suggested questions">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="msg user">
                <p className="text">{m.text}</p>
              </div>
            ) : i === lastIndex && waiting ? (
              <div key={i} className="msg assistant thinking" role="status">
                <span>Thinking…</span>
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ) : (
              <AssistantMessage key={i} message={m} />
            ),
          )}
        </div>
      </div>

      {showJump && (
        <button
          type="button"
          className="jump"
          onClick={() => {
            stickToBottom.current = true;
            scrollToBottom(true);
          }}
        >
          Jump to latest ↓
        </button>
      )}

      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor="message" className="sr-only">
          Ask about Elementary Music EDGE resources
        </label>
        <textarea
          id="message"
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="Type your question…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby={input.length > MAX_CHARS - 200 ? "char-count" : undefined}
        />
        <button type="submit" className="send" disabled={busy || !input.trim() || tooLong}>
          Send
        </button>
        {input.length > MAX_CHARS - 200 && (
          <p id="char-count" className={`count${tooLong ? " over" : ""}`}>
            {input.length}/{MAX_CHARS}
          </p>
        )}
      </form>

      <footer className="footer">
        Need help with your account? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </footer>
    </div>
  );
}

function Avatar() {
  const [src, setSrc] = useState("/avatar.jpg");
  return (
    <img
      className="avatar"
      src={src}
      alt=""
      width={36}
      height={36}
      onError={() => setSrc("/avatar-placeholder.svg")}
    />
  );
}

function AssistantMessage({ message }: { message: Extract<Message, { role: "assistant" }> }) {
  return (
    <div className={`msg assistant${message.error ? " error" : ""}`}>
      {message.parts.map((part, i) =>
        part.type === "text" ? (
          part.text.trim() ? (
            <p key={i} className="text">
              <RichText text={part.text.trim()} />
            </p>
          ) : null
        ) : (
          <ResourceCard key={`${part.id}-${i}`} part={part} />
        ),
      )}
    </div>
  );
}

function ResourceCard({ part }: { part: Extract<Part, { type: "card" }> }) {
  const workshop = part.kind === "Workshop";
  return (
    <div className="card">
      <span className={`label ${workshop ? "workshop" : "resource"}`}>{part.kind}</span>
      <p className="card-title">{part.title}</p>
      {part.desc.trim() && (
        <p className="card-desc">
          <RichText text={part.desc.trim()} />
        </p>
      )}
      <a className="card-button" href={part.url} target="_blank" rel="noopener noreferrer">
        {workshop ? "Watch workshop" : "Open resource"}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

// Renders **bold** only. Every other markdown character shows as typed. The
// support address becomes a mailto link.
function RichText({ text }: { text: string }) {
  const pieces = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {pieces.map((piece, i) =>
        /^\*\*[^*]+\*\*$/.test(piece) ? (
          <strong key={i}>{withEmailLinks(piece.slice(2, -2))}</strong>
        ) : (
          <Fragment key={i}>{withEmailLinks(piece)}</Fragment>
        ),
      )}
    </>
  );
}

function withEmailLinks(text: string) {
  const pieces = text.split(/((?:mailto:)?hello@thatmusicteacher\.com)/gi);
  return pieces.map((piece, i) =>
    i % 2 === 1 ? (
      <a key={i} href={`mailto:${SUPPORT_EMAIL}`}>
        {SUPPORT_EMAIL}
      </a>
    ) : (
      piece
    ),
  );
}

function applyEvent(parts: Part[], event: Exclude<StreamEvent, { type: "error" }>): Part[] {
  const copy = parts.slice();
  const last = copy[copy.length - 1];
  if (event.type === "card") {
    copy.push({ type: "card", id: event.id, kind: event.kind, title: event.title, url: event.url, desc: "" });
  } else if (event.type === "desc" && last?.type === "card") {
    copy[copy.length - 1] = { ...last, desc: last.desc + event.text };
  } else if (last?.type === "text") {
    copy[copy.length - 1] = { ...last, text: last.text + event.text };
  } else {
    copy.push({ type: "text", text: event.text });
  }
  return copy;
}

function hasContent(part: Part) {
  return part.type === "card" || part.text.trim().length > 0;
}

// Rebuilds what the assistant said, with cards turned back into record-ID
// tokens so Claude can keep earlier recommendations in follow-ups.
function toApiHistory(messages: Message[]) {
  return messages
    .filter((m) => m.role === "user" || !m.error)
    .map((m) =>
      m.role === "user"
        ? { role: "user" as const, content: m.text }
        : {
            role: "assistant" as const,
            content: m.parts
              .map((p) => (p.type === "text" ? p.text : `\n{{${p.id}}}\n${p.desc.trim()}\n`))
              .join("")
              .trim(),
          },
    )
    .filter((m) => m.content)
    .reduce<{ role: "user" | "assistant"; content: string }[]>((acc, m) => {
      // Drop failed exchanges so roles keep alternating.
      if (acc.length && acc[acc.length - 1].role === m.role) acc[acc.length - 1] = m;
      else acc.push(m);
      return acc;
    }, [])
    .slice(-HISTORY_SENT);
}

function isMessage(value: unknown): value is Message {
  const m = value as Message;
  if (m?.role === "user") return typeof m.text === "string";
  return m?.role === "assistant" && Array.isArray(m.parts);
}
