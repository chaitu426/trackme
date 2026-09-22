import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(error.toProblemDetails(), { status: error.status });
  }

  console.error("Unhandled API error:", error);
  return NextResponse.json(
    {
      error: "Internal server error",
    },
    { status: 500 }
  );
}
