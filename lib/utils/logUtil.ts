import winston, { format, Logger } from "winston";

const PROCESSOR_NAME = "ldes-client";

const consoleTransport = new winston.transports.Console();

if (typeof process !== "undefined") {
    consoleTransport.level =
        process.env.LOG_LEVEL ||
        (process.env.DEBUG?.includes(PROCESSOR_NAME) ||
        process.env.DEBUG === "*"
            ? "debug"
            : "info");
}

const classLoggers = new WeakMap<Constructor, Logger>();
const stringLoggers = new Map<string, Logger>();

export function getLoggerFor(loggable: string | Instance): Logger {
    let logger: Logger;
    if (typeof loggable === "string") {
        if (stringLoggers.has(loggable)) {
            logger = stringLoggers.get(loggable)!;
        } else {
            logger = createLogger(loggable);
            stringLoggers.set(loggable, logger);
        }
    } else {
        const { constructor } = loggable;
        if (classLoggers.has(constructor)) {
            logger = classLoggers.get(constructor)!;
        } else {
            logger = createLogger(constructor.name);
            classLoggers.set(constructor, logger);
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
