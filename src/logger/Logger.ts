export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  AUDIT = 'AUDIT',
}

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private component: string;

  constructor(component: string) {
    this.component = component;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      ...(data ? { data } : {}),
    };

    const color = {
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[32m',  // Green
      [LogLevel.WARN]: '\x1b[33m',  // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.AUDIT]: '\x1b[35m', // Magenta
    }[level];
    const reset = '\x1b[0m';

    console.log(
      `${color}[${entry.timestamp}] [${entry.level}] [${entry.component}]${reset} ${entry.message}`,
      data ? JSON.stringify(data, null, 2) : ''
    );
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, data);
  }

  audit(action: string, details: Record<string, unknown>): void {
    this.log(LogLevel.AUDIT, `[AUDIT_SECURITY] ${action}`, details);
  }
}
