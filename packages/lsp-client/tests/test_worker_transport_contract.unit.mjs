import assert from 'node:assert/strict';
import test from 'node:test';

import { SimpleLSPClient } from '../src/simple-client.js';
import {
    CURRENT_WORKER_PROTOCOL_VERSION,
    WORKER_CAPABILITIES,
    WorkerTransport,
} from '../src/worker-transport.js';
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

test('WorkerTransport makes no-board selection explicit by default', () => {
    const noBoard = new WorkerTransport('worker.js');
    const remoteBoard = new WorkerTransport('worker.js', {
        boardStubsUrl: 'https://example.test/stubs.zip',
    });

    assert.equal(noBoard._boardStubs, false);
    assert.equal(remoteBoard._boardStubs, undefined);
});

class HandshakeWorker {
    static loadedMessage = { type: 'serverLoaded' };
    static instances = [];

    constructor() {
        this.messages = [];
        this.terminated = false;
        HandshakeWorker.instances.push(this);
        queueMicrotask(() => this.onmessage?.({ data: HandshakeWorker.loadedMessage }));
    }

    postMessage(message) {
        this.messages.push(message);
        if (message.type === 'initServer') {
            queueMicrotask(() => this.onmessage?.({
                data: { type: 'serverInitialized', pyrightVersion: 'test' },
            }));
        }
    }

    terminate() {
        this.terminated = true;
    }
}

async function connectWithHandshake(loadedMessage) {
    const originalWorker = globalThis.Worker;
    HandshakeWorker.loadedMessage = loadedMessage;
    HandshakeWorker.instances = [];
    globalThis.Worker = HandshakeWorker;
    const transport = new WorkerTransport('worker.js');
    try {
        await transport.connect();
        return { transport, worker: HandshakeWorker.instances[0] };
    } finally {
        globalThis.Worker = originalWorker;
    }
}

test('WorkerTransport treats missing protocol metadata as legacy v1', async () => {
    const { transport, worker } = await connectWithHandshake({ type: 'serverLoaded' });

    assert.equal(transport.protocolVersion, 1);
    assert.equal(
        transport.supportsCapability(WORKER_CAPABILITIES.RUNTIME_STUB_PACKAGES),
        true,
    );
    assert.equal(worker.messages[0].type, 'initServer');
    transport.close();
});

test('WorkerTransport accepts current protocol capabilities', async () => {
    const { transport } = await connectWithHandshake({
        type: 'serverLoaded',
        protocolVersion: CURRENT_WORKER_PROTOCOL_VERSION,
        capabilities: [WORKER_CAPABILITIES.RUNTIME_STUB_PACKAGES],
    });

    assert.equal(transport.protocolVersion, CURRENT_WORKER_PROTOCOL_VERSION);
    assert.deepEqual(
        [...transport.capabilities],
        [WORKER_CAPABILITIES.RUNTIME_STUB_PACKAGES],
    );
    transport.close();
});

test('WorkerTransport rejects unsupported protocol before initServer', async () => {
    const originalWorker = globalThis.Worker;
    HandshakeWorker.loadedMessage = {
        type: 'serverLoaded',
        protocolVersion: CURRENT_WORKER_PROTOCOL_VERSION + 1,
        capabilities: [],
    };
    HandshakeWorker.instances = [];
    globalThis.Worker = HandshakeWorker;
    const transport = new WorkerTransport('worker.js');

    try {
        await assert.rejects(
            transport.connect(),
            /unsupported worker control protocol 3; supported range is 1-2/,
        );
    } finally {
        globalThis.Worker = originalWorker;
    }

    assert.deepEqual(HandshakeWorker.instances[0].messages, []);
    assert.equal(HandshakeWorker.instances[0].terminated, true);
});

test('disconnect awaits shutdown response before sending exit', async () => {
    const sent = [];
    const client = new SimpleLSPClient({ shutdownTimeout: 50 });
    client.connected = true;
    client.transport = {
        send(message) {
            const parsed = JSON.parse(message);
            sent.push(parsed);
            if (parsed.method === 'shutdown') {
                queueMicrotask(() => client.handleMessage(JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsed.id,
                    result: null,
                })));
            }
        },
    };

    await client.disconnect();

    assert.deepEqual(sent.map(({ method, params }) => ({ method, params })), [
        { method: 'shutdown', params: null },
        { method: 'exit', params: null },
    ]);
    assert.equal(client.connected, false);
});

test('disconnect sends exit after a bounded shutdown timeout', async () => {
    const sent = [];
    const errors = [];
    const originalError = console.error;
    const client = new SimpleLSPClient({ shutdownTimeout: 1 });
    client.connected = true;
    client.transport = {
        send(message) {
            sent.push(JSON.parse(message));
        },
    };
    console.error = (...args) => errors.push(args);

    try {
        await client.disconnect();
    } finally {
        console.error = originalError;
    }

    assert.deepEqual(sent.map(({ method }) => method), ['shutdown', 'exit']);
    assert.match(String(errors[0]?.[1]), /Request shutdown timed out/);
    assert.equal(client.connected, false);
});

test('informational logging is quiet by default and opt-in', () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const calls = [];
    const warnings = [];
    const errors = [];
    console.log = (...args) => calls.push(args);
    console.warn = (...args) => warnings.push(args);
    console.error = (...args) => errors.push(args);

    try {
        const quietTransport = createTransport({ workerUrl: 'quiet-worker.js' });
        quietTransport.close();
        const quietClient = new SimpleLSPClient();
        quietClient.handleNotification('test/quiet', { value: 1 });
        quietClient.handleNotification('window/showMessage', { type: 2, message: 'warning' });
        quietClient.handleNotification('window/showMessage', { type: 1, message: 'error' });
        assert.deepEqual(calls, []);
        assert.deepEqual(warnings, [['[LSP WARNING]:', 'warning']]);
        assert.deepEqual(errors, [['[LSP ERROR]:', 'error']]);

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
        console.warn = originalWarn;
        console.error = originalError;
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

test('workspace configuration defaults to the MicroPython typeshed', () => {
    const client = new SimpleLSPClient();
    const configuration = client.requestHandlers.get('workspace/configuration')({
        items: [{ section: 'python.analysis' }],
    });

    assert.deepEqual(configuration[0].typeshedPaths, ['/typeshed-micropython']);
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
    transport.capabilities.add(WORKER_CAPABILITIES.RUNTIME_STUB_PACKAGES);
    transport.worker = {
        postMessage(message) {
            messages.push(message);
        },
    };
    return { transport, messages };
}

test('stub package operations require the negotiated capability', async () => {
    const transport = new WorkerTransport('worker.js');
    transport.connected = true;
    transport.worker = { postMessage() {} };

    await assert.rejects(
        transport.listStubPackages(),
        /does not support capability "runtimeStubPackages"/,
    );
});

test('stub package methods use correlated worker requests', async () => {
    const { transport, messages } = connectedTransport();

    const filters = { family: 'micropython', version: '1.28.0', port: 'esp32' };
    const catalogPromise = transport.listStubPackages(filters);
    const catalogRequest = messages.shift();
    assert.equal(catalogRequest.type, 'listStubPackages');
    assert.deepEqual(catalogRequest.filters, filters);
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
            availableRuntimeVersions: ['1.28.0', '1.27.0', '1.26.1'],
            defaultRuntimeVersion: '1.28.0',
        },
    });
    const catalog = await catalogPromise;
    assert.equal(catalog[0].packageName, 'micropython-esp32-stubs');

    const metadataPromise = transport.getStubPackageCatalog();
    const metadataRequest = messages.shift();
    assert.deepEqual(metadataRequest.filters, {});
    transport._onSteadyStateMessage({
        data: {
            type: 'listStubPackagesResult',
            requestId: metadataRequest.requestId,
            ok: true,
            packages: [],
            availableRuntimeVersions: ['1.28.0', '1.27.0', '1.26.1'],
            defaultRuntimeVersion: '1.28.0',
        },
    });
    const metadata = await metadataPromise;
    assert.equal(metadata.defaultRuntimeVersion, '1.28.0');
    assert.deepEqual(metadata.availableRuntimeVersions.slice(0, 3), ['1.28.0', '1.27.0', '1.26.1']);

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
