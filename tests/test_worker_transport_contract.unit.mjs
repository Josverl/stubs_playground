import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkerTransport } from '../src/lsp/worker-transport.js';
import { createTransport } from '../src/lsp/transport-factory.js';

test('WorkerTransport requires an explicit worker URL', () => {
    assert.throws(
        () => new WorkerTransport(),
        /WorkerTransport requires a workerUrl/,
    );
});

test('createTransport preserves the supplied worker URL', () => {
    const transport = createTransport({ workerUrl: 'https://example.test/worker.js' });

    assert.equal(transport.workerUrl, 'https://example.test/worker.js');
});

test('createTransport rejects app-specific implicit URL resolution', () => {
    assert.throws(
        () => createTransport(),
        /createTransport requires options\.workerUrl/,
    );
});
