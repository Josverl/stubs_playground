import assert from 'node:assert/strict';
import test from 'node:test';

import { SimpleLSPClient } from '../src/simple-client.js';
import { WorkerTransport } from '../src/worker-transport.js';
import { createTransport } from '../src/transport-factory.js';

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

test('workspace configuration exposes the requested Pyright diagnostic mode', () => {
    const client = new SimpleLSPClient({ diagnosticMode: 'workspace' });
    const configuration = client.requestHandlers.get('workspace/configuration')({
        items: [{ section: 'python.analysis' }],
    });

    assert.equal(configuration[0].diagnosticMode, 'workspace');
});

test('workspace file methods send typed worker protocol messages', () => {
    const messages = [];
    const transport = new WorkerTransport('worker.js');
    transport.connected = true;
    transport.worker = {
        postMessage(message) {
            messages.push(message);
        },
    };

    transport.syncWorkspaceFile('lib/helpers.py', 'answer = 42\n');
    transport.deleteWorkspaceFile('lib/helpers.py');

    assert.deepEqual(messages, [{
        type: 'syncFile',
        path: 'lib/helpers.py',
        content: 'answer = 42\n',
    }, {
        type: 'deleteFile',
        path: 'lib/helpers.py',
    }]);
});

test('workspace file methods reject disconnected and invalid writes', () => {
    const disconnected = new WorkerTransport('worker.js');
    assert.throws(
        () => disconnected.syncWorkspaceFile('main.py', ''),
        /WorkerTransport: not connected/,
    );

    const transport = new WorkerTransport('worker.js');
    transport.connected = true;
    transport.worker = { postMessage() {} };

    for (const path of ['', '/main.py', '../main.py', 'lib/../main.py', 'lib\\main.py']) {
        assert.throws(
            () => transport.syncWorkspaceFile(path, ''),
            /Workspace file path/,
            path,
        );
        assert.throws(
            () => transport.deleteWorkspaceFile(path),
            /Workspace file path/,
            path,
        );
    }
    assert.throws(
        () => transport.syncWorkspaceFile('main.py', new Uint8Array()),
        /Workspace file content must be a string/,
    );
});
