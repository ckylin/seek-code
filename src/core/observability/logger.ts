// ── Harness-style Structured Logger ─────────────────────────────────────────
// Provides leveled, structured logging with namespace support.
// Events are emitted through the EventBus for centralized collection.

import { getDefaultEventBus, type ErrorEvent } from '../events/bus.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  namespace: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface LoggerConfig {
  minLevel: LogLevel;
  /** If true, emit error events to EventBus */
  emitErrors: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private config: LoggerConfig;

  constructor(private namespace: string, config?: Partial<LoggerConfig>) {
    this.config = {
      minLevel: config?.minLevel ?? (process.env.CODEGRUNT_LOG_LEVEL as LogLevel) ?? 'info',
      emitErrors: config?.emitErrors ?? true,
    };
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  /** Create a child logger with a sub-namespace */
  child(subNamespace: string): Logger {
    return new Logger(`${this.namespace}:${subNamespace}`, this.config);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.config.minLevel]) return;

    const entry: LogEntry = {
      level,
      namespace: this.namespace,
      message,
      data,
      timestamp: Date.now(),
    };

    // Structured output to stderr (doesn't interfere with stdout streaming)
    const prefix = `[${entry.namespace}] ${level.toUpperCase()}:`;
    if (level === 'error') {
      process.stderr.write(`\n${prefix} ${message}\n`);
    } else if (level === 'warn') {
      process.stderr.write(`\n${prefix} ${message}\n`);
    } else if (process.env.CODEGRUNT_VERBOSE) {
      process.stderr.write(`${prefix} ${message}\n`);
    }

    // Emit error events to bus
    if (level === 'error' && this.config.emitErrors) {
      const bus = getDefaultEventBus();
      const errorEvent: ErrorEvent = {
        type: 'error',
        source: this.namespace,
        message,
        stack: data?.stack as string | undefined,
        timestamp: entry.timestamp,
      };
      bus.emit(errorEvent);
    }
  }
}

// ── Convenience factory ────────────────────────────────────────────────────

const loggers = new Map<string, Logger>();

export function getLogger(namespace: string): Logger {
  if (!loggers.has(namespace)) {
    loggers.set(namespace, new Logger(namespace));
  }
  return loggers.get(namespace)!;
}
