// One-time Google sign-in for the timeline: prints a refresh token for GOOGLE_REFRESH_TOKEN and
// lists your calendars so you can pick GOOGLE_CALENDAR_ID. Run it in your own terminal (it prints a secret).
//
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from an OAuth client of type "Desktop app"
// (Google Cloud Console → APIs & Services → Credentials), with the Google Calendar API enabled.
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader";
// Read-only: the dashboard only reads the calendar; Hermes does the booking with its own access.
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TIMEOUT_MS = 5 * 60_000;

interface Client {
  id: string;
  secret: string;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is missing from .env. Create an OAuth client of type "Desktop app" in Google Cloud Console`);
    console.error("(APIs & Services → Credentials), enable the Google Calendar API, and put its id and secret in .env.");
    process.exit(1);
  }
  return value;
}

/** Starts a loopback server, prints the consent URL, and resolves with the code Google redirects back. */
function signIn(client: Client, verifier: string, state: string): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let redirectUri = "";
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") {
        response.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const ok = !error && code !== null && url.searchParams.get("state") === state;
      response
        .writeHead(ok ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" })
        .end(ok ? "Signed in. You can close this tab and go back to the terminal." : "Sign-in failed. Check the terminal.");
      clearTimeout(timer);
      server.close();
      if (ok) resolve({ code, redirectUri });
      else reject(new Error(error ? `Google returned "${error}"` : "The sign-in response did not match this request"));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out after 5 minutes waiting for the Google sign-in"));
    }, TIMEOUT_MS);

    // Port 0 lets the OS pick a free port; Desktop OAuth clients accept any loopback port.
    server.listen(0, "127.0.0.1", () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const params = new URLSearchParams({
        client_id: client.id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPE,
        access_type: "offline",
        // Makes Google return a refresh token even if you signed in before.
        prompt: "consent",
        code_challenge: base64Url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
        state,
      });
      console.log("Open this URL in your browser and sign in with the Google account that owns your calendar:\n");
      console.log(`${AUTH_URL}?${params.toString()}\n`);
      console.log("Waiting for Google to redirect back…");
    });
  });
}

async function main(): Promise<void> {
  const client = { id: requiredEnv("GOOGLE_CLIENT_ID"), secret: requiredEnv("GOOGLE_CLIENT_SECRET") };
  const verifier = base64Url(randomBytes(32));
  const { code, redirectUri } = await signIn(client, verifier, base64Url(randomBytes(16)));

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  const tokens = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!tokenResponse.ok || !tokens.access_token) {
    throw new Error(`Token exchange failed: ${tokens.error_description ?? tokenResponse.status}`);
  }

  const listResponse = await fetch(CALENDAR_LIST_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const list = (await listResponse.json()) as { items?: { id: string; summary?: string; primary?: boolean }[] };
  console.log('\nYour calendars (put the one you want in GOOGLE_CALENDAR_ID; "primary" also works for your main one):\n');
  for (const calendar of list.items ?? []) {
    const label = `${calendar.summary ?? "(no name)"}${calendar.primary ? "  [primary]" : ""}`;
    console.log(`  ${label.padEnd(40)} ${calendar.id}`);
  }

  if (!tokens.refresh_token) {
    console.log("\nGoogle did not return a refresh token. Remove this app's access at");
    console.log("https://myaccount.google.com/permissions and run this command again.");
    process.exitCode = 1;
    return;
  }
  console.log("\nAdd this line to your .env (keep it secret):\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
