/**
 * Screenshots the chat inside a stand-in parent page at phone and desktop
 * widths.
 *
 * 1. Start the app with the stand-in parent allowed:
 *      ALLOWED_PARENT_ORIGINS=http://localhost:3001 npm run build && \
 *      ALLOWED_PARENT_ORIGINS=http://localhost:3001 npm start
 * 2. npm run screenshots            (asks a live question; needs API keys)
 *    npm run screenshots -- --sample (renders a stored sample conversation;
 *                                     no API calls)
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const PARENT_PORT = 3001;
const OUT = path.join(process.cwd(), "test-results", "screenshots");
const SAMPLE = process.argv.includes("--sample");
const QUESTION = "I'm starting ukulele with 4th grade. Where do I begin?";

const SAMPLE_CONVERSATION = [
  { role: "user", text: QUESTION },
  {
    role: "assistant",
    parts: [
      { type: "text", text: "Great choice! Here's a **step-by-step path** for getting 4th graders strumming:\n" },
      {
        type: "card",
        id: "recK0gcE6zQWvpDej",
        kind: "Workshop",
        title: "Sequencing Ukulele Instruction for Elementary Music",
        url: "https://thatmusicteacher.thrivecart.com/l/elementary-music-edge/sequencing-ukulele-instruction-for-elementary-music-with-jennifer-bailey/",
        desc: "Jennifer Bailey walks through how to sequence ukulele from the very first lesson, which is exactly where you're starting.",
      },
      {
        type: "card",
        id: "rec0DWXeLeABaPKyd",
        kind: "Resource",
        title: "Sequencing Ukulele Instruction (Resource Pack)",
        url: "https://drive.google.com/file/d/1rEV8v51AZJ1DN-Mn-EtXGMvzio8apJ8H/view",
        desc: "The companion pack with ready-to-use materials that follow the workshop's sequence.",
      },
    ],
  },
];

function parentPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Member area (stand-in)</title>
<style>body{margin:0;font-family:Arial,sans-serif;background:#fff}.wrap{max-width:900px;margin:0 auto;padding:12px}</style></head>
<body><div class="wrap">
<iframe src="${APP}" title="Elementary Music EDGE Assistant" style="width:100%;height:calc(100vh - 24px);border:0;border-radius:12px;" allow="clipboard-write"></iframe>
</div></body></html>`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(parentPage());
  });
  await new Promise<void>((resolve) => server.listen(PARENT_PORT, resolve));

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  });
  const suffix = SAMPLE ? "sample" : "live";
  try {
    for (const vp of [
      { name: "phone", width: 390, height: 844 },
      { name: "desktop", width: 1280, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
      if (SAMPLE) {
        await context.addInitScript(
          ({ app, data }) => {
            if (location.origin === new URL(app).origin && window.self !== window.top) {
              sessionStorage.setItem("edge-assistant-chat-v1", data);
            }
          },
          { app: APP, data: JSON.stringify(SAMPLE_CONVERSATION) },
        );
      }
      const page = await context.newPage();

      if (!SAMPLE) {
        await page.goto(`http://localhost:${PARENT_PORT}`);
        const frame = page.frameLocator("iframe");
        await frame.locator(".chip").first().waitFor();
        await page.screenshot({ path: path.join(OUT, `${vp.name}-greeting.png`) });
        await frame.locator("textarea").fill(QUESTION);
        await frame.locator(".send").click();
        await frame.locator(".card-button").first().waitFor({ timeout: 60_000 });
        // Give the rest of the reply time to finish streaming.
        await page.waitForTimeout(6000);
      } else {
        await page.goto(`http://localhost:${PARENT_PORT}`);
        await page.frameLocator("iframe").locator(".card").first().waitFor();
      }
      await page.screenshot({ path: path.join(OUT, `${vp.name}-reply-${suffix}.png`) });

      // Opened directly instead of inside the member area.
      const direct = await context.newPage();
      await direct.goto(APP);
      await direct.locator(".blocked").waitFor();
      await direct.screenshot({ path: path.join(OUT, `${vp.name}-opened-directly.png`) });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`Screenshots saved to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
