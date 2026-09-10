const sensitiveKey =
  /(?:secret|password|api[-_]?key|private[-_]?key|authorization|rpc[-_]?url|sentry[-_]?dsn)/i;

/** Remove credentials before data reaches any reporting or storage boundary. */
export function redactText(value: string): string {
  let result = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (sensitiveKey.test(key) && secret && secret.length >= 4) {
      result = result.split(secret).join("[REDACTED]");
    }
  }
  result = result.replace(/https?:\/\/[^\s"'<>\\]+/gi, (text) => {
    try {
      const url = new URL(text);
      return `${url.protocol}//${url.host}/[REDACTED]`;
    } catch {
      return "[REDACTED URL]";
    }
  });
  result = result.replace(/\b(Bearer|Basic)\s+[^\s,"'}]+/gi, "$1 [REDACTED]");
  return result.replace(
    /((?:api[_-]?key|secret|password|private[_-]?key|authorization)\s*[=:]\s*["']?)[^\s,"'}]+/gi,
    "$1[REDACTED]"
  );
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: redactText(value.name),
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
      cause: redact(value.cause, seen),
    };
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redact(entry, seen),
    ])
  );
}
