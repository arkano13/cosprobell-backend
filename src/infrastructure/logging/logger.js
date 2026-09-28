import pino from "pino";

export const logger = pino({
  redact: ["req.headers.authorization", "req.headers['x-api-key']"],
});
