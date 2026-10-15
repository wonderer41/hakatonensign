// Production server for Homelab Daily: `next start` plus the client allowlist (DASHBOARD_ALLOWED_CIDRS).
// Usage: npm run start            Docker: node --import tsx scripts/server.ts
//
// Why not src/proxy.ts: Proxy only sees request headers. Next fills X-Forwarded-For from the socket
// only when the client did not send one, so any client can claim to be 127.0.0.1. Here the decision
// uses req.socket.remoteAddress, the TCP peer, before Next sees the request. `npm run dev` does not
// use this file, so development allows everyone.
import { createServer, STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import next from "next";
import { describeAccessList, loadAccessList } from "@/lib/acl/access-list";
import { createDenialLog } from "@/lib/acl/denial-log";
import { createAclGate, forbiddenResponse, type AclGate } from "@/lib/acl/gate";

// Long-lived requests (the /api/stream event stream) would keep close() waiting; cut them after this.
const SHUTDOWN_GRACE_MS = 5_000;

function readPort(): number {
  const raw = process.env.PORT?.trim() || "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`PORT "${raw}" is not a valid port`);
  return port;
}

function loadGate(): AclGate {
  try {
    const list = loadAccessList();
    const startup = describeAccessList(list, process.env.NODE_ENV);
    if (startup.level === "warn") console.warn(startup.message);
    else console.log(startup.message);
    const denials = createDenialLog();
    setInterval(() => denials.flush(), 60_000).unref();
    return createAclGate(list, denials);
  } catch (error) {
    // A bad entry stops the server instead of silently allowing everyone.
    console.error(`[acl] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const port = readPort();
  // dev: false — this only serves the output of `next build`. webpack: true compiles nothing here;
  // it only stops next() from setting TURBOPACK=auto, which `next start` never sets either.
  const app = next({ dev: false, port, webpack: true });
  const handle = app.getRequestHandler();
  // prepare() loads next.config and the .env files the same way `next start` does, so read the list after it.
  await app.prepare();
  const gate = loadGate();

  // Rendered once so refusals are written synchronously, before anything else can touch the socket.
  const refusal = forbiddenResponse();
  const refusalBody = Buffer.from(await refusal.arrayBuffer());
  const refusalHeaders = {
    "content-type": refusal.headers.get("content-type") ?? "application/json",
    "content-length": String(refusalBody.length),
    "cache-control": "no-store",
    connection: "close",
  };
  const refusalHead =
    `HTTP/1.1 ${refusal.status} ${STATUS_CODES[refusal.status]}\r\n` +
    Object.entries(refusalHeaders)
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join("") +
    "\r\n";

  const server = createServer((req, res) => {
    if (!gate(req.socket.remoteAddress)) {
      res.writeHead(refusal.status, refusalHeaders);
      res.end(refusalBody);
      return;
    }
    handle(req, res).catch((error: unknown) => {
      console.error(`Failed to handle request for ${req.url?.split("?")[0]}`);
      console.error(error);
      if (res.headersSent) res.destroy();
      else {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  // Registered before Next adds its own "upgrade" listener (on the first request), so refused
  // peers are answered and the socket closed here; allowed upgrades are left to Next.
  server.on("upgrade", (req, socket: Duplex) => {
    if (!gate(req.socket.remoteAddress)) {
      socket.end(Buffer.concat([Buffer.from(refusalHead), refusalBody]));
      return;
    }
    // Nothing upgrades in production (HMR is dev-only): answer instead of leaving the socket open.
    socket.end("HTTP/1.1 426 Upgrade Required\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal} received, shutting down`);
    setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
    server.close(() => {
      void app
        .close()
        .catch((error: unknown) => console.error(error))
        .finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
    });
    server.closeIdleConnections();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.on("error", (error) => {
    console.error("[server] failed to start", error);
    process.exit(1);
  });
  // No host: every interface, IPv4 and IPv6, like `next start`. IPv4 peers then show up as
  // ::ffff:a.b.c.d, which the allowlist normalises.
  server.listen(port, () => console.log(`[server] ready on port ${port}`));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
