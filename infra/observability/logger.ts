export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  service?: string;
  workspaceId?: string;
  siteId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(
    private readonly service: string,
    private readonly defaultContext: LogContext = {}
  ) {}

  public child(context: LogContext): Logger {
    return new Logger(this.service, { ...this.defaultContext, ...context });
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...this.defaultContext,
      ...context,
    };

    const output = JSON.stringify(entry);
    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  public debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  public error(message: string, context?: LogContext): void {
    this.log("error", message, context);
  }
}

export const createLogger = (service: string, context?: LogContext) =>
  new Logger(service, context);

