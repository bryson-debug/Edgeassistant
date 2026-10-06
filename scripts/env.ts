import fs from "node:fs";
import path from "node:path";

// Minimal .env.local reader for the scripts. Values already in the
// environment win, and nothing is ever printed.
export function loadEnvFile(file = ".env.local") {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
