import { randomUUID } from "node:crypto";
import {
  pino,
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
  type LogFn,
} from "pino";

const REDACTED = "[Redacted]";
const MAX_REDACTION_DEPTH = 12;

export interface ChassisLoggingOptions {
  /** Pino level. Defaults to LOG_LEVEL or info. */
  level?: LevelWithSilent;
  /** Injectable pino destination for embedding and deterministic log capture. */
  destination?: DestinationStream;
}

export interface RequestLogContext {
  requestId: string;
  logger: Logger;
}

export function createRequestLogContext(
  logger: Logger,
  tenantId: string | null,
  requestId: string = randomUUID(),
): RequestLogContext {
  return {
    requestId,
    logger: logger.child({ request_id: requestId, tenant_id: tenantId }),
  };
}

export function createChassisLogger(
  unitName: string,
  options: ChassisLoggingOptions = {},
): Logger {
  const config: LoggerOptions = {
    base: { unit_name: unitName },
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    formatters: {
      bindings(bindings: Record<string, unknown>) {
        return redactLogValue(bindings) as Record<string, unknown>;
      },
      log(object: Record<string, unknown>) {
        return redactLogValue(object) as Record<string, unknown>;
      },
    },
    hooks: {
      logMethod(
        this: Logger,
        args: [msg: string, ...args: unknown[]],
        method: LogFn,
      ) {
        method.apply(
          this,
          args.map((arg) => redactLogValue(arg)) as [
            msg: string,
            ...args: unknown[],
          ],
        );
      },
    },
  };
  const logger = options.destination
    ? pino(config, options.destination)
    : pino(config);
  return secureLogger(logger);
}

function secureLogger(logger: Logger): Logger {
  return new Proxy(logger, {
    get(target, property, receiver) {
      if (property === "child") {
        return (bindings: Bindings, options?: ChildLoggerOptions) =>
          secureLogger(
            target.child(redactLogValue(bindings) as Bindings, options),
          );
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function safeRequestPath(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/, 1)[0] ?? "/";
  }
  return path.replace(/^\/mcp\/[^/]+$/, "/mcp/:token");
}

function redactLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return redactString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (depth >= MAX_REDACTION_DEPTH) return "[Truncated]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      type: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
      ...(value.cause !== undefined
        ? { cause: redactLogValue(value.cause, depth + 1, seen) }
        : {}),
    };
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, depth + 1, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = isSensitiveKey(key)
      ? REDACTED
      : redactLogValue(nested, depth + 1, seen);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();
  return (
    normalized === "authorization" ||
    normalized === "proxy_authorization" ||
    normalized === "cookie" ||
    normalized === "set_cookie" ||
    normalized === "state" ||
    normalized === "oauth_state" ||
    /(^|_)(?:token|secret|password|credential|api_key|private_key)($|_)/.test(
      normalized,
    )
  );
}

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/(\/mcp\/)[^/?#\s]+/gi, "$1:token")
    .replace(
      /([?&](?:access_token|refresh_token|id_token|token|state|oauth_state|api_key|secret|password)=)[^&#\s]*/gi,
      `$1${REDACTED}`,
    );
}
