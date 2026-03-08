import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const SENSITIVE_PATTERNS = [
  /(?<=api[_-]?key[=:]\s*")[^"]+/gi,
  /(?<=secret[=:]\s*")[^"]+/gi,
  /(?<=password[=:]\s*")[^"]+/gi,
  /(?<=token[=:]\s*")[^"]+/gi,
  /(?<=authorization[=:]\s*")[^"]+/gi,
  /0x[a-fA-F0-9]{64}/g, // private keys
];

function scrubValue(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function scrubObject(obj: unknown): unknown {
  if (typeof obj === "string") return scrubValue(obj);
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(scrubObject);

  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("secret") ||
      lowerKey.includes("password") ||
      lowerKey.includes("apikey") ||
      lowerKey.includes("api_key") ||
      lowerKey.includes("private_key") ||
      lowerKey.includes("authorization")
    ) {
      scrubbed[key] = "[REDACTED]";
    } else {
      scrubbed[key] = scrubObject(value);
    }
  }
  return scrubbed;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  hooks: {
    logMethod(inputArgs, method) {
      const scrubbedArgs = inputArgs.map((arg) =>
        typeof arg === "object" ? scrubObject(arg) : typeof arg === "string" ? scrubValue(arg) : arg
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      method.apply(this, scrubbedArgs as any);
    },
  },
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});
