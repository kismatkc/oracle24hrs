
const { spawn } = require("child_process");
const { URL } = require("url");

// Resolve the redis-commander CLI entry installed in node_modules.
const BIN = require.resolve("redis-commander/bin/redis-commander.js");

/** Parse a redis:// or rediss:// URL into parts (host/port/db/password). */
function parseRedisUrl(maybeUrl) {
  try {
    if (!maybeUrl) return {};
    const u = new URL(maybeUrl);
    return {
      host: u.hostname || "127.0.0.1",
      port: u.port || (u.protocol === "rediss:" ? "6380" : "6379"),
      db: (u.pathname || "/0").slice(1) || "0",
      // For URLs like redis://:password@host:port/db
      password: u.password || undefined,
    };
  } catch {
    // If it's not a valid URL, just ignore it.
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read all inputs from ENV (Doppler populates these before this script runs).
// ─────────────────────────────────────────────────────────────────────────────
const {
  // GUI binding (local only by default; Nginx proxies to it)
  REDIS_GUI_HTTP_HOST,
  REDIS_GUI_HTTP_PORT,

  // GUI Basic Auth (what your browser will prompt for)
  REDIS_GUI_USER,
  REDIS_GUI_PASS,

  // Separate Redis connection fields (recommended to avoid URL-encoding gotchas)
  REDIS_HOST,
  REDIS_PORT,
  REDIS_DB,
  REDIS_PASSWORD,

  // Optional single connection string alternatives (use only if fields are missing)
  REDDIS_CONNECTIONSTRING, // your project’s legacy name
  REDIS_URL,               // common alias

  // Reverse-proxy awareness
  URL_PREFIX,              // e.g. "/redis"
  TRUST_PROXY,             // e.g. "1" to enable
} = process.env;

// If only a URL is provided, parse it as a fallback.
const parsedFromUrl = parseRedisUrl(REDDIS_CONNECTIONSTRING || REDIS_URL);

// Final config resolved with precedence: explicit fields → parsed URL → defaults.
const cfg = {
  // Where Redis Commander listens (keep 127.0.0.1 for safety)
  httpHost: REDIS_GUI_HTTP_HOST || "127.0.0.1",
  httpPort: REDIS_GUI_HTTP_PORT || "8081",

  // GUI login (optional but recommended)
  guiUser: REDIS_GUI_USER,
  guiPass: REDIS_GUI_PASS,

  // Redis connection
  host: REDIS_HOST || parsedFromUrl.host || "127.0.0.1",
  port: REDIS_PORT || parsedFromUrl.port || "6379",
  db:   REDIS_DB   || parsedFromUrl.db   || "0",
  pass: REDIS_PASSWORD || parsedFromUrl.password, // prefer explicit var

  // Reverse proxy prefix + proxy headers
  urlPrefix: URL_PREFIX || "/redis",
  trustProxy: !!TRUST_PROXY, // anything truthy enables it
};

// Build command-line args for redis-commander.
const args = [];
const add = (flag, val) => { if (val !== undefined && String(val).length) args.push(flag, String(val)); };

// Web UI bind + auth
add("--http-host", cfg.httpHost);
add("--http-port", cfg.httpPort);
add("--http-auth-username", cfg.guiUser);
add("--http-auth-password", cfg.guiPass);

// Redis connection (split flags avoid URL-encoding issues like '@' in passwords)
add("--redis-host", cfg.host);
add("--redis-port", cfg.port);
add("--redis-db",   cfg.db);
add("--redis-password", cfg.pass);

// Safer key listing + reverse-proxy awareness
add("--use-scan", "true");
add("--url-prefix", cfg.urlPrefix);
if (cfg.trustProxy) args.push("--trust-proxy");

// Minimal, sanitized debug so you can confirm what the process *sees*.
console.log("[redis-gui] cfg:", {
  REDIS_HOST: cfg.host,
  REDIS_PORT: cfg.port,
  REDIS_DB:   cfg.db,
  REDIS_PASSWORD: cfg.pass ? "***set***" : "(missing)",
  HTTP_HOST:  cfg.httpHost,
  HTTP_PORT:  cfg.httpPort,
  URL_PREFIX: cfg.urlPrefix,
  TRUST_PROXY: cfg.trustProxy,
});
console.log("[redis-gui] argv:", args.map(a => (a === cfg.pass ? "***pass***" : a)));

// Spawn redis-commander with inherited stdio so logs show in pm2 logs.
const child = spawn(process.execPath, [BIN, ...args], {
  stdio: "inherit",
  env: process.env, // keep full env available (harmless)
});

// Bubble up exit codes to PM2.
child.on("close", (code) => process.exit(code));

// Cleanly handle signals forwarded by PM2/systemd.
process.on("SIGINT",  () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
