import assert from 'node:assert/strict';
import test from 'node:test';

import { SimpleLSPClient } from '../packages/lsp-client/src/simple-client.js';
import { WorkerTransport } from '../packages/lsp-client/src/worker-transport.js';
import { createTransport } from '../packages/lsp-client/src/transport-factory.js';

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

test('onNotification returns an idempotent unsubscribe callback', () => {
    const client = new SimpleLSPClient();
    const received = [];
    const unsubscribe = client.onNotification((method, params) => {
        received.push({ method, params });
    });

    client.handleNotification('test/before', { value: 1 });
    unsubscribe();
    unsubscribe();
    client.handleNotification('test/after', { value: 2 });

    assert.deepEqual(received, [
        { method: 'test/before', params: { value: 1 } },
    ]);
});
