// Ticker rules shared by the watchlist service and the Hermes request parser (no DB import here,
// so parsers stay unit-testable).

/** Uppercase ticker: a letter, then letters, digits, "." or "-" (e.g. BRK.B); 16 = the VarChar size. */
export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;

/** The stocks banner shows at most this many rows (banner-payload MAX_STOCK_ROWS). */
export const WATCHLIST_MAX_SYMBOLS = 50;
