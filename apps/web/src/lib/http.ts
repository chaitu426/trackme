import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { AnalyticsOverloadedError, AnalyticsQueryError, AnalyticsRangeTooWideError } from "@trackme/analytics";
import { SessionStoreUnavailableError, SessionPersistError } from "./session-store";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(error.toProblemDetails(), { status: error.status });
  }
  if (error instanceof AnalyticsRangeTooWideError) {
    return NextResponse.json(
      new AppError(422, error.code, error.message).toProblemDetails(),
      { status: 422 }
    );
  }
  if (error instanceof AnalyticsOverloadedError) {
    return NextResponse.json(new AppError(429, "ANALYTICS_BUSY", error.message).toProblemDetails(), {
      status: 429,
      headers: { "Retry-After": "2" },
    });
  }
  if (error instanceof AnalyticsQueryError) {
    return NextResponse.json(
      new AppError(502, error.code, "Analytics is temporarily unavailable. Retry in a moment.").toProblemDetails(),
      { status: 502 }
    );
  }
  if (error instanceof SessionStoreUnavailableError || error instanceof SessionPersistError) {
    return NextResponse.json(
      new AppError(503, "SESSION_STORE_UNAVAILABLE", error.message).toProblemDetails(),
      { status: 503 }
    );
  }

  console.error("Unhandled API error:", error);
  return NextResponse.json(
    {
      error: "Internal server error",
    },
    { status: 500 }
  );
}
