# Elementary Music EDGE Assistant

A members-only chat assistant that recommends up to three Elementary Music EDGE resources or workshops from the Airtable catalog, with direct links. It runs inside an iframe on a members-only ThriveCart page.

## How a reply is built

1. Claude gets the system prompt (`prompts/system-prompt.txt`) plus the catalog: every resource and workshop with record ID, type, title, author or presenter, and description. URLs and transcripts are never sent to Claude. The prompt and catalog are a cached prefix, so the catalog is billed at the cache-read rate on repeat messages.
2. Claude names an item only by writing `{{recXXXXXXXXXXXXXX}}` on its own line, followed by one sentence.
3. The server (`lib/reply-filter.ts`) swaps each token for a card that uses the exact Airtable title and URL. It drops unknown IDs and logs them as errors, and removes any URL Claude writes on its own, except `mailto:hello@thatmusicteacher.com`.
4. Claude has one tool, `search_transcripts(query)`. It runs a keyword search over the transcripts on the server and returns up to 5 workshop record IDs, each with a two-sentence snippet. Transcripts never reach the browser.

The catalog is refreshed from Airtable at most every 5 minutes. Records without a URL are skipped.

## Editing the system prompt

Edit `prompts/system-prompt.txt` and redeploy. The server adds one line after it, "Today's date is …", so requests like "this month's menu" work.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `AIRTABLE_TOKEN` | Airtable personal access token with `data.records:read` on base `appqNfq390NUKfoD9` |
| `MODEL` | Optional. Defaults to `claude-haiku-4-5` |
| `ALLOWED_PARENT_ORIGINS` | `https://thatmusicteacher.thrivecart.com` (comma-separated if more) |
| `ADMIN_PASSWORD` | Password for the admin chat log at `/admin`. Admin is off when unset. Changing it signs everyone out. |
| `LOG_SALT` | Optional. A long random string used to hash visitor IPs. Set it once and leave it, or visitor IDs change. Falls back to `ADMIN_PASSWORD`. |

Rate limiting (30 messages an hour and 100 a day per IP address) needs **Upstash Redis**. Add it from the Vercel Marketplace (Storage → Upstash → Redis) and connect it to this project; it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Without it, each server instance counts separately, which is much weaker.

## Admin chat log

Open `https://YOUR-APP.vercel.app/admin` directly (not inside ThriveCart) and sign in with `ADMIN_PASSWORD`.

- **Overview:** messages, conversations, Claude cost and the share of questions with no recommendation over the last 7 and 30 days, a 14-day table, and this month's most recommended items.
- **Conversations:** newest first. Each shows every member question, the reply as it was shown (text, cards and the exact links), any transcript searches Claude ran, invalid record IDs that were dropped, token usage, cost and response time.
- **Search and filters:** text search over questions and replies, and filters for "No recommendation" (often a catalog gap), "Errors or invalid IDs" and "Rate limited". Search covers the latest 2,000 messages.
- **CSV export** for the last 30, 90 or 365 days.

Privacy: a conversation is grouped by a random ID the browser creates, which resets on "New chat". Visitors appear as a 12-character one-way hash of the IP address; raw IPs are never stored. Logs, including rate-limited attempts, delete themselves after 1 year. Members see "Chats are saved to help us improve the assistant." in the footer.

Logs are stored in the same Upstash Redis as rate limiting. Without Redis they're kept in memory, which is for local development only: they vanish on restart and aren't shared between server instances.

## Security

- `Content-Security-Policy: frame-ancestors` comes from `ALLOWED_PARENT_ORIGINS`, so browsers refuse to show the page inside any other site. Opened directly in a tab, it shows a message pointing members to the member area.
- `/api/chat` rejects any request whose `Origin` isn't the app's own domain.
- Member messages are capped at 1,000 characters and Claude's replies at 800 tokens.
- `/admin` can't be framed and isn't indexed. Sign-in uses a signed, HTTP-only cookie that lasts 12 hours, is limited to 10 attempts an hour per IP, and rejects cross-site form posts.

## Colors and contrast

White text on the brand teal `#12a99f` is 2.9:1, which fails WCAG AA at every size. Surfaces that carry text (the header, member bubbles and buttons) use **`#0c8079`** instead, which is 4.8:1 with white. The brand teal, gold and orange are used only where they don't carry text, except dark text on gold labels (10.7:1).

## Embed code for ThriveCart

Replace the `src` with the deployed URL:

```html
<iframe
  src="https://YOUR-APP.vercel.app/"
  title="Elementary Music EDGE Assistant"
  width="100%"
  height="720"
  style="width:100%;height:720px;max-height:85vh;min-height:520px;border:0;border-radius:12px;display:block;"
  allow="clipboard-write"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

## Development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
npm test                     # unit tests: link filter, transcript search, request checks
npm run lint                 # type check
npm run test:questions       # 24-question live test → test-results/report.md
```

To view the chat locally it has to be framed by an allowed parent. Set `ALLOWED_PARENT_ORIGINS=http://localhost:3001`, build and start the app, then run `npm run screenshots`. It serves a stand-in parent page on port 3001 and saves phone and desktop screenshots to `test-results/screenshots/`. Add `-- --sample` to render a stored conversation without calling the API.

The avatar is `public/avatar.jpg`. Until that file exists, a placeholder is shown.
