import pino from "pino";
import { redact } from "./redaction.js";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  hooks: {
    logMethod(inputArgs, method) {
      const scrubbedArgs = inputArgs.map((arg) => redact(arg));
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
