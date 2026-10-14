// Postgres NOTIFY channel that carries LiveEvents between processes (decision D12):
// the app and the worker publish with pg_notify, every app process LISTENs once
// and fans the events out to its open /api/stream connections.
export const LIVE_CHANNEL = "homelab_daily_live";
