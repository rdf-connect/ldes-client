import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, OutgoingMessage } from '../lib/fetcher/workerAdapter';
import { DataFactory } from 'rdf-data-factory';
import { quadToStringQuad } from 'rdf-string';

const DF = new DataFactory();

// Hoisted mock setup
const { extractMock } = vi.hoisted(() => {
    return { extractMock: vi.fn().mockResolvedValue([]) };
});

vi.mock('extract-cbd-shape', () => ({
    CBDShapeExtractor: vi.fn(function () {
        return {
            extract: extractMock
        };
    })
}));

describe('extractionWebWorker', () => {
    let postMessageMock: any;

    beforeEach(async () => {
        vi.resetModules();

        postMessageMock = vi.fn();

        // Mock global self
        const selfMock = {
            onmessage: null as ((msg: MessageEvent) => void) | null,
            postMessage: postMessageMock,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };
        vi.stubGlobal('self', selfMock);
        vi.stubGlobal('window', selfMock); // Fix for tiny-set-immediate or other browser-detecting libs

        // Import the worker to run its top-level code
        await import('../lib/fetcher/extractionWebWorker');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
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

        // Trigger onmessage
        // @ts-ignore
        if (self.onmessage) {
            // @ts-ignore
            self.onmessage({ data: initMsg } as MessageEvent);
        }

        // Send extract message
        const extractMsg: IncomingMessage = {
            type: 'extract',
            members: ['http://example.org/s1'],
            quads: [],
        };

        // Trigger onmessage
        // @ts-ignore
        if (self.onmessage) {
            // @ts-ignore
            self.onmessage({ data: extractMsg } as MessageEvent);
        }

        // Wait for async operations to complete
        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify postMessage calls
        // @ts-ignore
        expect(self.postMessage).toHaveBeenCalled();

        // @ts-ignore
        const calls = self.postMessage.mock.calls;
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
