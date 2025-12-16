// logger.ts
export interface Logger {
    debug(...message: unknown[]): void;
    info(...message: unknown[]): void;
    warn(...message: unknown[]): void;
    error(...message: unknown[]): void;
    verbose(...message: unknown[]): void;
}

export function scopedLogger(base: Logger, scope: string): Logger {
    return {
        debug: (msg, meta) => base.debug(`[${scope}] ${msg}`, meta),
        info: (msg, meta) => base.info(`[${scope}] ${msg}`, meta),
        warn: (msg, meta) => base.warn(`[${scope}] ${msg}`, meta),
        error: (msg, meta) => base.error(`[${scope}] ${msg}`, meta),
        verbose: (msg, meta) => base.verbose(`[${scope}] ${msg}`, meta),
    };
}

const empty: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    verbose: () => {},
};

let baseLogger: Logger = empty;
setLogger(console);
export function setLogger(l: Partial<Logger>) {
    baseLogger = Object.assign({}, empty, l);
}
export function getBaseLogger(): Logger {
    return baseLogger;
}

export function getLoggerFor(obj: string | object): Logger {
    const name = typeof obj === "string" ? obj : obj.constructor.name;
    return scopedLogger(baseLogger, name);
}
