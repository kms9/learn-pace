import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import process from "node:process";

const serial = process.argv[2];
if (!serial) {
  console.error("Pass an adb device serial");
  process.exit(1);
}
process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
const names = [
  "PI_OPENAI_BASE_URL", "PI_MODEL", "PI_OPENAI_API", "PI_REASONING",
  "PI_CONTEXT_WINDOW", "PI_MAX_TOKENS", "OPENAI_API_KEY",
];
const config = Object.fromEntries(names.map((name) => [name, process.env[name]]));
if (!config.PI_OPENAI_BASE_URL || !config.OPENAI_API_KEY) {
  console.error("Local model configuration is incomplete");
  process.exit(1);
}
const endpoint = "tcp:18765";
const adb = (...args) => execFileSync("adb", ["-s", serial, "reverse", ...args], { stdio: "ignore" });
const code = String(randomInt(100000, 1000000));
let attemptsRemaining = 5;
let tunnelOpen = false;
let claimed = false;
const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/config") {
    res.writeHead(404).end();
    return;
  }
  if (claimed || req.headers["x-learn-pace-pairing"] !== code) {
    res.writeHead(403).end();
    if (--attemptsRemaining === 0) server.close();
    return;
  }
  claimed = true;
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" });
  res.end(JSON.stringify(config), () => server.close());
});
const timer = setTimeout(() => server.close(), 90_000);
server.once("close", () => {
  clearTimeout(timer);
  if (tunnelOpen) {
    try { adb("--remove", endpoint); } catch {}
  }
});
server.listen(18765, "127.0.0.1", () => {
  try {
    adb("--no-rebind", endpoint, endpoint);
    tunnelOpen = true;
    console.log(`Enter USB pairing code ${code} within 90 seconds`);
  } catch {
    console.error("Could not create adb reverse tunnel");
    process.exitCode = 1;
    server.close();
  }
});
process.once("SIGINT", () => server.close());
process.once("SIGTERM", () => server.close());
