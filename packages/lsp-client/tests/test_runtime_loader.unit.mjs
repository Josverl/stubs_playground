import assert from 'node:assert/strict';
import test from 'node:test';

import { startWorkerRuntime } from '../src/runtime-loader.js';

const ORIGIN = 'https://runtime.example';
const MANIFEST_URL = `${ORIGIN}/runtime-manifest.json`;

async function digest(bytes) {
    const value = await crypto.subtle.digest('SHA-256', bytes);
    return Buffer.from(value).toString('hex');
}

async function runtimeFixture(runtimeId, workerSource = `self.runtime = ${JSON.stringify(runtimeId)};`) {
    const worker = new TextEncoder().encode(workerSource);
    const sha256 = await digest(worker);
    return {
        worker,
        manifest: {
            $schema: 'runtime-manifest.schema.json',
            schemaVersion: 1,
            runtimeId,
            package: { name: '@example/worker', version: '1.0.0' },
            worker: { url: `worker-${runtimeId}.js`, size: worker.byteLength, sha256 },
            pyrightVersion: '1.1.386',
            typeshed: {
                identity: 'test-typeshed',
                url: 'typeshed.zip',
                size: 1,
                sha256: '1'.repeat(64),
            },
            controlProtocol: {
                minimumVersion: 1,
                maximumVersion: 2,
                capabilities: ['runtimeStubPackages'],
            },
            catalog: {
                url: 'catalog.json',
                size: 1,
                sha256: '2'.repeat(64),
                schemaVersion: '2.0',
            },
            fallbackArchives: [],
        },
    };
}

function installBrowserStorage() {
    const originalCaches = globalThis.caches;
    const originalLocalStorage = globalThis.localStorage;
    const stores = new Map();
    const values = new Map();
    globalThis.caches = {
        async open(name) {
            if (!stores.has(name)) stores.set(name, new Map());
            const store = stores.get(name);
            return {
                async match(key) {
                    return store.get(String(key))?.clone();
                },
                async put(key, response) {
                    store.set(String(key), response.clone());
                },
                async delete(key) {
                    return store.delete(String(key));
                },
            };
        },
    };
    globalThis.localStorage = {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
    };
    return () => {
        globalThis.caches = originalCaches;
        globalThis.localStorage = originalLocalStorage;
    };
}

test('startWorkerRuntime preserves bundled-only startup when manifest is omitted', async () => {
    const seen = [];
    const selected = await startWorkerRuntime(
        { bundledWorkerUrl: '/bundled-worker.js' },
        async (candidate) => {
            seen.push(candidate.workerUrl);
            return 'connected';
        },
    );

    assert.deepEqual(seen, ['/bundled-worker.js']);
    assert.equal(selected.value, 'connected');
    assert.equal(selected.source, 'bundled');
    assert.deepEqual(selected.fallbacks, []);
});

test('startWorkerRuntime verifies and records a remote runtime', async () => {
    const restoreStorage = installBrowserStorage();
    const originalFetch = globalThis.fetch;
    const fixture = await runtimeFixture('runtime-a');
    globalThis.fetch = async (url) => {
        if (String(url) === MANIFEST_URL) {
            return new Response(JSON.stringify(fixture.manifest));
        }
        if (String(url) === `${ORIGIN}/worker-runtime-a.js`) {
            return new Response(fixture.worker);
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    try {
        const selected = await startWorkerRuntime(
            {
                bundledWorkerUrl: '/bundled-worker.js',
                manifestUrl: MANIFEST_URL,
                allowedOrigins: [ORIGIN],
                storageKey: 'runtime-test',
            },
            async (candidate) => candidate.runtimeId,
        );

        assert.equal(selected.value, 'runtime-a');
        assert.equal(selected.source, 'remote');
        assert.match(localStorage.getItem('runtime-test'), /runtime-a/);
    } finally {
        globalThis.fetch = originalFetch;
        restoreStorage();
    }
});

test('startWorkerRuntime rolls failed current startup back to cached last-known-good', async () => {
    const restoreStorage = installBrowserStorage();
    const originalFetch = globalThis.fetch;
    const fixtureA = await runtimeFixture('runtime-a');
    const fixtureB = await runtimeFixture('runtime-b');
    let current = fixtureA;
    globalThis.fetch = async (url) => {
        if (String(url) === MANIFEST_URL) {
            return new Response(JSON.stringify(current.manifest));
        }
        if (String(url) === `${ORIGIN}/worker-${current.manifest.runtimeId}.js`) {
            return new Response(current.worker);
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    try {
        await startWorkerRuntime(
            {
                bundledWorkerUrl: '/bundled-worker.js',
                manifestUrl: MANIFEST_URL,
                allowedOrigins: [ORIGIN],
                storageKey: 'runtime-test',
            },
            async () => 'first-start',
        );
        current = fixtureB;

        const selected = await startWorkerRuntime(
            {
                bundledWorkerUrl: '/bundled-worker.js',
                manifestUrl: MANIFEST_URL,
                allowedOrigins: [ORIGIN],
                storageKey: 'runtime-test',
            },
            async (candidate) => {
                if (candidate.source === 'remote') throw new Error('startup rejected');
                return candidate.runtimeId;
            },
        );

        assert.equal(selected.source, 'last-known-good');
        assert.equal(selected.value, 'runtime-a');
        assert.deepEqual(selected.fallbacks, [
            { source: 'remote', error: 'startup rejected' },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
        restoreStorage();
    }
});

test('startWorkerRuntime rejects incompatible manifests before remote startup', async () => {
    const restoreStorage = installBrowserStorage();
    const originalFetch = globalThis.fetch;
    const fixture = await runtimeFixture('runtime-new');
    fixture.manifest.controlProtocol.minimumVersion = 3;
    fixture.manifest.controlProtocol.maximumVersion = 3;
    globalThis.fetch = async () => new Response(JSON.stringify(fixture.manifest));
    const sources = [];

    try {
        const selected = await startWorkerRuntime(
            {
                bundledWorkerUrl: '/bundled-worker.js',
                manifestUrl: MANIFEST_URL,
                allowedOrigins: [ORIGIN],
            },
            async (candidate) => {
                sources.push(candidate.source);
                return candidate.source;
            },
        );

        assert.deepEqual(sources, ['bundled']);
        assert.equal(selected.source, 'bundled');
        assert.match(selected.fallbacks[0].error, /control protocol is incompatible/);
    } finally {
        globalThis.fetch = originalFetch;
        restoreStorage();
    }
});

test('startWorkerRuntime rejects corrupt worker bytes and uses bundled fallback', async () => {
    const restoreStorage = installBrowserStorage();
    const originalFetch = globalThis.fetch;
    const fixture = await runtimeFixture('runtime-corrupt');
    globalThis.fetch = async (url) => (
        String(url) === MANIFEST_URL
            ? new Response(JSON.stringify(fixture.manifest))
            : new Response(new TextEncoder().encode('corrupt'))
    );

    try {
        const selected = await startWorkerRuntime(
            {
                bundledWorkerUrl: '/bundled-worker.js',
                manifestUrl: MANIFEST_URL,
                allowedOrigins: [ORIGIN],
            },
            async (candidate) => candidate.source,
        );

        assert.equal(selected.source, 'bundled');
        assert.match(selected.fallbacks[0].error, /size .* does not match/);
    } finally {
        globalThis.fetch = originalFetch;
        restoreStorage();
    }
});
