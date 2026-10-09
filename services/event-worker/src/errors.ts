/** Raised when a row cannot be represented in ClickHouse, as opposed to the database being unavailable. */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

/**
 * ClickHouse server codes that mean "this row is bad", not "the server is
 * unhealthy". Anything else is treated as infrastructure and retried.
 */
const DATA_ERROR_CODES = new Set([
  "6", // CANNOT_PARSE_TEXT
  "26", // CANNOT_PARSE_QUOTED_STRING
  "27", // CANNOT_PARSE_INPUT_ASSERTION_FAILED
  "38", // CANNOT_PARSE_DATE
  "41", // CANNOT_PARSE_DATETIME
  "53", // TYPE_MISMATCH
  "117", // INCORRECT_DATA
]);

export function isDataError(err: unknown): boolean {
  if (err instanceof DataError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return code !== undefined && DATA_ERROR_CODES.has(String(code));
}
