import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export const REQUEST_ID_HEADER = "x-request-id";

export function getRequestId(request: Request | NextRequest): string {
  const existing = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (existing && existing.length <= 128) return existing;
  return randomUUID();
}

export function withRequestId<T extends Response>(response: T, requestId: string): T {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function jsonWithRequestId(
  requestId: string,
  body: unknown,
  init?: ResponseInit
): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}
