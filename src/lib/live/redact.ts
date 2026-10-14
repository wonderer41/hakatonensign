// Error text for logs: one line, short, and without credentials. Database and HTTP client
// errors can echo connection strings or headers, so this scrubs them before anything is printed.

type Env = Record<string, string | undefined>;

const MAX_LENGTH = 300;
const MIN_SECRET_LENGTH = 6;
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASS|DATABASE_URL)/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes URL passwords, bearer tokens and the values of secret-looking env vars from `text`. */
export function redactSecrets(text: string, env: Env = process.env): string {
  const secrets = Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === "string" && value.trim().length >= MIN_SECRET_LENGTH)
    .map(([, value]) => (value as string).trim())
    .sort((a, b) => b.length - a.length);
  let result = text;
  for (const secret of secrets) result = result.replace(new RegExp(escapeRegExp(secret), "g"), "***");
  return result
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@/]+@/gi, "$1***@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 ***");
}

/** `text` as a single, redacted, length-capped log line. */
export function safeLogText(text: string, env: Env = process.env): string {
  const oneLine = redactSecrets(text, env).replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_LENGTH ? `${oneLine.slice(0, MAX_LENGTH - 1)}…` : oneLine;
}

/** A single-line, redacted, length-capped message for any thrown value. */
export function safeErrorMessage(error: unknown, env: Env = process.env): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return safeLogText(raw, env) || "Unknown error";
}
