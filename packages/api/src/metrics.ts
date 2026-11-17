interface MetricEntry {
  count: number;
  totalMs: number;
  lastMs: number;
}

const requestMetrics = new Map<string, MetricEntry>();
const flashprofitsRequests = new Map<string, number>();
let totalRequests = 0;
let totalErrors = 0;
const startTime = Date.now();

export function recordRequest(path: string, durationMs: number, isError: boolean): void {
  totalRequests++;
  if (isError) totalErrors++;

  const existing = requestMetrics.get(path);
  if (existing) {
    existing.count++;
    existing.totalMs += durationMs;
    existing.lastMs = durationMs;
  } else {
    requestMetrics.set(path, {
      count: 1,
      totalMs: durationMs,
      lastMs: durationMs,
    });
  }
}

export function recordFlashprofitsRequest(
  status: number | "cancelled" | "timeout" | "network_error"
): void {
  const outcome = String(status);
  flashprofitsRequests.set(outcome, (flashprofitsRequests.get(outcome) ?? 0) + 1);
}

export function getMetrics(): string {
  const lines: string[] = [];
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  lines.push(`# HELP spandex_uptime_seconds Server uptime in seconds`);
  lines.push(`# TYPE spandex_uptime_seconds gauge`);
  lines.push(`spandex_uptime_seconds ${uptimeSeconds}`);

  lines.push(`# HELP spandex_requests_total Total number of HTTP requests`);
  lines.push(`# TYPE spandex_requests_total counter`);
  lines.push(`spandex_requests_total ${totalRequests}`);

  lines.push(`# HELP spandex_errors_total Total number of error responses`);
  lines.push(`# TYPE spandex_errors_total counter`);
  lines.push(`spandex_errors_total ${totalErrors}`);

  lines.push(`# HELP spandex_request_duration_ms Average request duration in milliseconds`);
  lines.push(`# TYPE spandex_request_duration_ms gauge`);
  for (const [path, metric] of requestMetrics) {
    const avgMs = Math.round(metric.totalMs / metric.count);
    lines.push(`spandex_request_duration_ms{path="${path}"} ${avgMs}`);
  }

  lines.push(`# HELP spandex_request_count Per-path request count`);
  lines.push(`# TYPE spandex_request_count counter`);
  for (const [path, metric] of requestMetrics) {
    lines.push(`spandex_request_count{path="${path}"} ${metric.count}`);
  }

  lines.push("# HELP flashprofits_upstream_requests_total Flashprofits HTTP requests by outcome");
  lines.push("# TYPE flashprofits_upstream_requests_total counter");
  for (const [outcome, count] of flashprofitsRequests) {
    lines.push(`flashprofits_upstream_requests_total{outcome="${outcome}"} ${count}`);
  }

  return lines.join("\n") + "\n";
}
