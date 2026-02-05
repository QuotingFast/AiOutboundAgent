import { config } from '../config';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

function ts(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
  if (level === LogLevel.DEBUG && !config.debug) return;

  const entry: Record<string, unknown> = {
    timestamp: ts(),
    level,
    component,
    message,
  };
  if (data) entry.data = data;

  const line = JSON.stringify(entry);
  if (level === LogLevel.ERROR) {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (component: string, msg: string, data?: Record<string, unknown>) => log(LogLevel.DEBUG, component, msg, data),
  info: (component: string, msg: string, data?: Record<string, unknown>) => log(LogLevel.INFO, component, msg, data),
  warn: (component: string, msg: string, data?: Record<string, unknown>) => log(LogLevel.WARN, component, msg, data),
  error: (component: string, msg: string, data?: Record<string, unknown>) => log(LogLevel.ERROR, component, msg, data),
};
