import winston, { format, Logger } from "winston";

const PROCESSOR_NAME = "ldes-client";

const consoleTransport = new winston.transports.Console();
consoleTransport.level =
    process.env.LOG_LEVEL ||
    (process.env.DEBUG?.includes(PROCESSOR_NAME) ||
    process.env.DEBUG === "*"
        ? "debug"
        : "info");

const classLoggers = new Map<string, Logger>();

export function getLoggerFor(loggable: string | Instance): Logger {
    let logger: Logger;
    if (typeof loggable === "string") {
        if (classLoggers.has(loggable)) {
            logger = classLoggers.get(loggable)!;
        } else {
            logger = createLogger(loggable);
            classLoggers.set(loggable, logger);
        }
    } else {
        const { constructor } = loggable;
        if (classLoggers.has(constructor.name)) {
            logger = classLoggers.get(constructor.name)!;
        } else {
            logger = createLogger(constructor.name);
            classLoggers.set(constructor.name, logger);
        }
    }
    return logger;
}

function createLogger(label: string): Logger {
    return winston.createLogger({
        format: format.combine(
            format.label({ label }),
            format.colorize(),
            format.timestamp(),
            format.metadata({
                fillExcept: ["level", "timestamp", "label", "message"],
            }),
            format.printf(
                ({
                    level: levelInner,
                    message,
                    label: labelInner,
                    timestamp,
                }): string =>
                    `${timestamp} {${PROCESSOR_NAME}} [${labelInner}] ${levelInner}: ${message}`,
            ),
        ),
        transports: [consoleTransport],
    });
}

/**
 * Any class constructor.
 */
interface Constructor {
    name: string;
}

/**
 * Any class instance.
 */
interface Instance {
    constructor: Constructor;
}
