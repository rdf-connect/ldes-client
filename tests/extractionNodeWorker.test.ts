import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, OutgoingMessage } from '../lib/fetcher/workerAdapter';
import { DataFactory } from 'rdf-data-factory';
import { quadToStringQuad } from 'rdf-string';

const DF = new DataFactory();

// Hoisted mock setup
const { parentPortMock, cbdExtractorMock } = vi.hoisted(() => {
    const listeners: Record<string, Function[]> = {};
    const extractMock = vi.fn().mockResolvedValue([]);
    return {
        parentPortMock: {
            on: vi.fn((event, handler) => {
                if (!listeners[event]) listeners[event] = [];
                listeners[event].push(handler);
            }),
            postMessage: vi.fn(),
            emit: (event: string, ...args: any[]) => {
                if (listeners[event]) {
                    listeners[event].forEach(fn => fn(...args));
                }
            },
            removeAllListeners: () => {
                for (const key in listeners) delete listeners[key];
            }
        },
        cbdExtractorMock: {
            CBDShapeExtractor: vi.fn(function () {
                return {
                    extract: extractMock
                };
            }),
            extractMock: extractMock
        }
    };
});

vi.mock('extract-cbd-shape', () => ({
    CBDShapeExtractor: cbdExtractorMock.CBDShapeExtractor
}));

vi.mock('node:worker_threads', () => ({
    parentPort: parentPortMock,
}));

describe('extractionNodeWorker', () => {
    beforeEach(async () => {
        vi.resetModules();
        // Clear previous calls but keep the implementation or logic if necessary
        vi.clearAllMocks();

        // Ensure no listeners from previous runs if we are reusing the emitter
        parentPortMock.removeAllListeners();

        // Setup extract mock return value if needed
        cbdExtractorMock.extractMock.mockResolvedValue([]);

        // Import the worker to run its top-level code (connection to parentPort)
        await import('../lib/fetcher/extractionNodeWorker');
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize and extract members', async () => {
        const quad1 = DF.quad(
            DF.namedNode('http://example.org/s1'),
            DF.namedNode('http://example.org/p1'),
            DF.namedNode('http://example.org/o1')
        );
        const quadString = quadToStringQuad(quad1);

        // Send initialize message
        const initMsg: IncomingMessage = {
            type: 'initalize',
            quads: [quadString],
            onlyDefaultGraphs: false,
        };

        // Simulate message arrival
        parentPortMock.emit('message', initMsg);

        // Send extract message
        const extractMsg: IncomingMessage = {
            type: 'extract',
            members: ['http://example.org/s1'],
            quads: [],
        };
        parentPortMock.emit('message', extractMsg);

        // Wait for async operations to complete
        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify postMessage calls
        // Since we are not doing a real extraction with CBDShapeExtractor (it's real but with minimal data),
        // we might expect an empty result or whatever CBDShapeExtractor returns for this input.
        // However, the important part is that the worker responds.

        // We expect at least one 'member' message and one 'done' message
        expect(parentPortMock.postMessage).toHaveBeenCalled();

        const calls = parentPortMock.postMessage.mock.calls;
        const memberCall = calls.find((call: any[]) => call[0].type === 'member');
        const doneCall = calls.find((call: any[]) => call[0].type === 'done');

        expect(memberCall).toBeDefined();
        if (memberCall) {
            const msg = memberCall[0] as OutgoingMessage;
            if (msg.type === 'member') {
                expect(msg.id).toBe('http://example.org/s1');
            }
        }

        expect(doneCall).toBeDefined();
    });
});
