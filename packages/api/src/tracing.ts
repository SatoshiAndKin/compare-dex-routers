import { randomUUID } from "node:crypto";
import type http from "node:http";

export function getRequestId(req: http.IncomingMessage): string {
  const existing = req.headers["x-request-id"];
  if (typeof existing === "string" && existing.length > 0) return existing;
  return randomUUID();
}

export function setTraceHeaders(res: http.ServerResponse, requestId: string): void {
  res.setHeader("x-request-id", requestId);
}
