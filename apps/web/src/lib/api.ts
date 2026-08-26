import { NextResponse } from "next/server";
import type { ApiErrorBody } from "@skilled/domain";

export type ApiErrorCode = ApiErrorBody["error"]["code"];

export function apiError(code: ApiErrorCode, message: string, status: number) {
  return NextResponse.json<ApiErrorBody>(
    { error: { code, message } },
    { status },
  );
}

export function internalApiError() {
  return apiError("INTERNAL_ERROR", "The request could not be completed.", 500);
}
