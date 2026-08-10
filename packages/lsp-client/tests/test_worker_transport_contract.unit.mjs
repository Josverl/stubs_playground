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

test('informational logging is quiet by default and opt-in', () => {
    const originalLog = console.log;
    const calls = [];
    console.log = (...args) => calls.push(args);

    try {
        const quietTransport = createTransport({ workerUrl: 'quiet-worker.js' });
        quietTransport.close();
        const quietClient = new SimpleLSPClient();
        quietClient.handleNotification('test/quiet', { value: 1 });
        assert.deepEqual(calls, []);

        const verboseTransport = createTransport({
            workerUrl: 'verbose-worker.js',
            verboseOutput: true,
        });
        verboseTransport.close();
        const verboseClient = new SimpleLSPClient({ verboseOutput: true });
        verboseClient.handleNotification('test/verbose', { value: 2 });

        assert.ok(calls.some(args => String(args[0]).includes('verbose-worker.js')));
        assert.ok(calls.some(args => String(args[0]).includes('WorkerTransport: closed')));
        assert.ok(calls.some(args => String(args[0]).includes('test/verbose')));
    } finally {
        console.log = originalLog;
    }
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

function connectedTransport() {
    const messages = [];
    const transport = new WorkerTransport('worker.js');
    transport.connected = true;
    transport.worker = {
        postMessage(message) {
            messages.push(message);
        },
    };
    return { transport, messages };
}

test('stub package methods use correlated worker requests', async () => {
    const { transport, messages } = connectedTransport();

    const catalogPromise = transport.listStubPackages();
    const catalogRequest = messages.shift();
    assert.equal(catalogRequest.type, 'listStubPackages');
    transport._onSteadyStateMessage({
        data: {
            type: 'listStubPackagesResult',
            requestId: catalogRequest.requestId,
            ok: true,
            packages: [{
                id: 'esp32',
                packageName: 'micropython-esp32-stubs',
                versions: [{ version: '1.28.0.post4' }],
            }],
        },
    });
    const catalog = await catalogPromise;
    assert.equal(catalog[0].packageName, 'micropython-esp32-stubs');

    const installPromise = transport.installStubPackage(
        'micropython-esp32-stubs',
        '==1.28.0.post4',
    );
    const installRequest = messages.shift();
    assert.deepEqual(
        {
            type: installRequest.type,
            packageName: installRequest.packageName,
            versionSpecifier: installRequest.versionSpecifier,
        },
        {
            type: 'installStubPackage',
            packageName: 'micropython-esp32-stubs',
            versionSpecifier: '==1.28.0.post4',
        },
    );
    transport._onSteadyStateMessage({
        data: {
            type: 'installStubPackageResult',
            requestId: installRequest.requestId,
            ok: true,
            package: {
                packageName: 'micropython-esp32-stubs',
                version: '1.28.0.post4',
            },
            restartRequired: true,
        },
    });
    assert.equal((await installPromise).version, '1.28.0.post4');

    const clearPromise = transport.clearStubPackages('micropython-esp32-stubs');
    const clearRequest = messages.shift();
    assert.equal(clearRequest.type, 'clearStubPackages');
    assert.equal(clearRequest.packageName, 'micropython-esp32-stubs');
    transport._onSteadyStateMessage({
        data: {
            type: 'clearStubPackagesResult',
            requestId: clearRequest.requestId,
            ok: true,
            removed: 2,
            restartRequired: true,
        },
    });
    assert.deepEqual(await clearPromise, { removed: 2, restartRequired: true });
});

test('stub package methods reject invalid input and worker errors', async () => {
    const { transport, messages } = connectedTransport();
    await assert.rejects(
        transport.installStubPackage(''),
        /Stub package name must be a non-empty string/,
    );

    const pending = transport.listInstalledStubPackages();
    const request = messages.shift();
    transport._onSteadyStateMessage({
        data: {
            type: 'listInstalledStubPackagesResult',
            requestId: request.requestId,
            ok: false,
            packages: [],
            error: 'IndexedDB unavailable',
        },
    });
    await assert.rejects(pending, /IndexedDB unavailable/);
});
