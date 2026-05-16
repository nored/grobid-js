// Logger shim used by ported code in place of upstream's `org.slf4j.Logger`.
// Mirrors slf4j's level set (debug/info/warn/error) with a thin wrapper over
// the host `console`. Loggers are named so output stays attributable to a
// specific upstream class.

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

type Level = "debug" | "info" | "warn" | "error" | "silent";

let threshold: Level = "warn";

const order: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

export function setLogLevel(level: Level): void {
  threshold = level;
}

function enabled(level: Exclude<Level, "silent">): boolean {
  return order[level] >= order[threshold];
}

export function getLogger(name: string): Logger {
  const tag = `[${name}]`;
  return {
    debug: (...args) => { if (enabled("debug")) console.debug(tag, ...args); },
    info: (...args) => { if (enabled("info")) console.info(tag, ...args); },
    warn: (...args) => { if (enabled("warn")) console.warn(tag, ...args); },
    error: (...args) => { if (enabled("error")) console.error(tag, ...args); },
  };
}
