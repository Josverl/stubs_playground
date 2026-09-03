import {
    CURRENT_WORKER_PROTOCOL_VERSION,
    MIN_SUPPORTED_WORKER_PROTOCOL_VERSION,
} from './worker-transport.js';

const DEFAULT_CACHE_NAME = 'mp-typing-worker-runtimes-v1';
const DEFAULT_STORAGE_KEY = 'mp-typing:last-known-good-runtime';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_WORKER_BYTES = 16 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * @typedef {'remote'|'last-known-good'|'bundled'} RuntimeSource
 */

/**
 * @typedef {Object} RuntimeFallback
 * @property {'remote'|'last-known-good'|'bundled'} source
 * @property {string} error
 */

/**
 * @typedef {Object} WorkerRuntimeOptions
 * @property {string} bundledWorkerUrl - Deterministic same-origin fallback worker.
 * @property {string} [manifestUrl] - Optional remote runtime manifest URL.
 * @property {string[]} [allowedOrigins] - Origins permitted for the manifest and
 *   every asset URL it contains.
 * @property {string} [cacheName] - Cache Storage namespace.
 * @property {string} [storageKey] - localStorage key for last-known-good metadata.
 */

/**
 * @typedef {Object} WorkerRuntimeCandidate
 * @property {string} workerUrl - Verified Blob URL or bundled worker URL.
 * @property {RuntimeSource} source - Candidate origin in the fallback chain.
 * @property {string} runtimeId - Immutable runtime identity, or `bundled`.
 * @property {RuntimeManifest|null} manifest - Validated runtime manifest.
 * @property {{url: string, size: number, sha256: string,
 *   allowedOrigins: string[]}|undefined} stubPackageCatalog
 */

/**
 * @typedef {{url: string, size: number, sha256: string}} RuntimeAsset
 * @typedef {RuntimeAsset & {identity: string}} RuntimeTypeshed
 * @typedef {RuntimeAsset & {schemaVersion: '2.0'}} RuntimeCatalog
 * @typedef {RuntimeAsset & {id: string, packageName: string,
 *   packageVersion: string}} RuntimeFallbackArchive
 * @typedef {Object} RuntimeManifest
 * @property {'runtime-manifest.schema.json'} $schema
 * @property {1} schemaVersion
 * @property {string} runtimeId
 * @property {{name: string, version: string}} package
 * @property {RuntimeAsset} worker
 * @property {string} pyrightVersion
 * @property {RuntimeTypeshed} typeshed
 * @property {{minimumVersion: number, maximumVersion: number,
 *   capabilities: string[]}} controlProtocol
 * @property {RuntimeCatalog} catalog
 * @property {RuntimeFallbackArchive[]} fallbackArchives
 */

/**
 * @typedef {Object} LoadedManifest
 * @property {RuntimeManifest} manifest
 * @property {string} manifestUrl
 * @property {string} manifestDigest
 */

/**
 * @typedef {Object} LastKnownGoodRecord
 * @property {string} manifestUrl
 * @property {string} manifestDigest
 * @property {string} runtimeId
 */

/**
 * @template T
 * @typedef {Object} WorkerRuntimeResult
 * @property {T} value - Value returned by the successful start callback.
 * @property {RuntimeSource} source - Successful runtime source.
 * @property {string} runtimeId - Successful immutable runtime identity.
 * @property {RuntimeManifest|null} manifest - Selected validated manifest.
 * @property {RuntimeFallback[]} fallbacks - Earlier rejected candidates.
 */

/** @param {unknown} error */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/** @param {unknown} value @param {string} label */
function validateDigest(value, label) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
        throw new Error(`${label} SHA-256 must be 64 lowercase hexadecimal characters`);
    }
    return value;
}

/** @param {unknown} value @param {number} maximum @param {string} label */
function validateSize(value, maximum, label) {
    if (
        typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value <= 0
        || value > maximum
    ) {
        throw new Error(`${label} size must be between 1 and ${maximum} bytes`);
    }
    return value;
}

/** @param {string} value @param {string[]} allowedOrigins @param {string} label */
function validateUrl(value, allowedOrigins, label) {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !localHttp) {
        throw new Error(`${label} URL must use HTTPS except on loopback`);
    }
    if (!allowedOrigins.includes(url.origin)) {
        throw new Error(`${label} origin is not allowed: ${url.origin}`);
    }
    return url;
}

/**
 * @param {unknown} asset
 * @param {string|URL} baseUrl
 * @param {string[]} allowedOrigins
 * @param {string} label
 * @param {number} maximum
 * @returns {RuntimeAsset}
 */
function validateAsset(asset, baseUrl, allowedOrigins, label, maximum) {
    if (!asset || typeof asset !== 'object') {
        throw new Error(`${label} must be an object`);
    }
    const candidate = /** @type {Record<string, unknown>} */ (asset);
    const url = validateUrl(
        new URL(String(candidate.url || ''), baseUrl).href,
        allowedOrigins,
        label,
    );
    return {
        url: url.href,
        size: validateSize(candidate.size, maximum, label),
        sha256: validateDigest(candidate.sha256, label),
    };
}

/** @param {Record<string, any>} value @param {string[]} allowed @param {string} label */
function requireOnlyKeys(value, allowed, label) {
    const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
    if (unexpected) throw new Error(`${label} contains unsupported property "${unexpected}"`);
}

/**
 * @param {unknown} candidate
 * @param {URL} manifestUrl
 * @param {string[]} allowedOrigins
 * @returns {RuntimeManifest}
 */
function validateManifest(candidate, manifestUrl, allowedOrigins) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('Runtime manifest must be an object');
    }
    const document = /** @type {Record<string, any>} */ (candidate);
    requireOnlyKeys(document, [
        '$schema',
        'schemaVersion',
        'runtimeId',
        'package',
        'worker',
        'pyrightVersion',
        'typeshed',
        'controlProtocol',
        'catalog',
        'fallbackArchives',
    ], 'Runtime manifest');
    if (document.$schema !== 'runtime-manifest.schema.json' || document.schemaVersion !== 1) {
        throw new Error('Runtime manifest schema is unsupported');
    }
    if (typeof document.runtimeId !== 'string' || document.runtimeId.length === 0) {
        throw new Error('Runtime manifest runtimeId is invalid');
    }
    if (
        !document.package
        || typeof document.package.name !== 'string'
        || document.package.name.length === 0
        || typeof document.package.version !== 'string'
        || document.package.version.length === 0
        || typeof document.pyrightVersion !== 'string'
        || document.pyrightVersion.length === 0
    ) {
        throw new Error('Runtime manifest package metadata is invalid');
    }
    requireOnlyKeys(document.package, ['name', 'version'], 'Runtime manifest package');
    const protocol = document.controlProtocol;
    if (
        !protocol
        || !Number.isSafeInteger(protocol.minimumVersion)
        || !Number.isSafeInteger(protocol.maximumVersion)
        || protocol.minimumVersion > protocol.maximumVersion
        || protocol.minimumVersion > CURRENT_WORKER_PROTOCOL_VERSION
        || protocol.maximumVersion < MIN_SUPPORTED_WORKER_PROTOCOL_VERSION
        || !Array.isArray(protocol.capabilities)
        || !protocol.capabilities.every(
            (/** @type {unknown} */ capability) => typeof capability === 'string',
        )
        || new Set(protocol.capabilities).size !== protocol.capabilities.length
    ) {
        throw new Error(
            `Runtime manifest control protocol is incompatible; client supports `
            + `${MIN_SUPPORTED_WORKER_PROTOCOL_VERSION}-${CURRENT_WORKER_PROTOCOL_VERSION}`,
        );
    }
    requireOnlyKeys(
        protocol,
        ['minimumVersion', 'maximumVersion', 'capabilities'],
        'Runtime manifest control protocol',
    );

    const worker = validateAsset(
        document.worker,
        manifestUrl,
        allowedOrigins,
        'Runtime worker',
        MAX_WORKER_BYTES,
    );
    const typeshed = validateAsset(
        document.typeshed,
        manifestUrl,
        allowedOrigins,
        'Runtime typeshed',
        MAX_WORKER_BYTES,
    );
    if (typeof document.typeshed.identity !== 'string' || document.typeshed.identity.length === 0) {
        throw new Error('Runtime manifest typeshed identity is invalid');
    }
    const catalog = validateAsset(
        document.catalog,
        manifestUrl,
        allowedOrigins,
        'Runtime catalog',
        MAX_MANIFEST_BYTES * 8,
    );
    if (document.catalog.schemaVersion !== '2.0') {
        throw new Error('Runtime catalog schema version must be 2.0');
    }
    if (!Array.isArray(document.fallbackArchives)) {
        throw new Error('Runtime fallbackArchives must be an array');
    }
    if (document.fallbackArchives.length > 100) {
        throw new Error('Runtime fallbackArchives exceeds 100 entries');
    }
    const fallbackArchives = document.fallbackArchives.map((asset, index) => {
        const validated = validateAsset(
            asset,
            manifestUrl,
            allowedOrigins,
            `Runtime fallback archive ${index}`,
            MAX_WORKER_BYTES,
        );
        const archive = /** @type {Record<string, unknown>} */ (asset);
        if (
            typeof archive.id !== 'string'
            || archive.id.length === 0
            || typeof archive.packageName !== 'string'
            || archive.packageName.length === 0
            || typeof archive.packageVersion !== 'string'
            || archive.packageVersion.length === 0
        ) {
            throw new Error(`Runtime fallback archive ${index} metadata is invalid`);
        }
        return {
            ...validated,
            id: archive.id,
            packageName: archive.packageName,
            packageVersion: archive.packageVersion,
        };
    });
    return {
        $schema: 'runtime-manifest.schema.json',
        schemaVersion: 1,
        runtimeId: document.runtimeId,
        package: document.package,
        worker,
        pyrightVersion: document.pyrightVersion,
        typeshed: { ...typeshed, identity: document.typeshed.identity },
        controlProtocol: protocol,
        catalog: { ...catalog, schemaVersion: '2.0' },
        fallbackArchives,
    };
}

/** @param {Response} response @param {number} maximum @param {string} label */
async function readBounded(response, maximum, label) {
    if (!response.ok) {
        throw new Error(`${label} download failed (${response.status})`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maximum) {
        throw new Error(`${label} exceeds ${maximum} bytes`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error(`${label} requires a streaming response body`);
    }
    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximum) {
            await reader.cancel(`${label} exceeds its byte limit`);
            throw new Error(`${label} exceeds ${maximum} bytes`);
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes.buffer;
}

/** @param {ArrayBuffer} data */
async function sha256(data) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(
        new Uint8Array(digest),
        (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
}

/** @param {string|URL} url @param {number} maximum @param {string} label */
async function fetchBytes(url, maximum, label) {
    /** @type {Response} */
    let response;
    try {
        response = await fetch(url, { redirect: 'error' });
    } catch (error) {
        throw new Error(`${label} download failed: ${errorMessage(error)}`);
    }
    return readBounded(response, maximum, label);
}

/** @param {string} url @param {string} digest */
function cacheKey(url, digest) {
    const key = new URL(url);
    key.searchParams.set('__mp_runtime_sha256', digest);
    return key.href;
}

/** @param {string} cacheName */
async function openRuntimeCache(cacheName) {
    return typeof caches === 'undefined' ? null : caches.open(cacheName);
}

/**
 * @param {Cache|null} cache
 * @param {string} url
 * @param {string} digest
 * @param {number} maximum
 * @param {string} label
 * @param {number} [expectedSize]
 */
async function cachedBytes(cache, url, digest, maximum, label, expectedSize) {
    if (!cache) return null;
    const response = await cache.match(cacheKey(url, digest));
    if (!response) return null;
    const data = await readBounded(response, maximum, label);
    if (
        (expectedSize !== undefined && data.byteLength !== expectedSize)
        || await sha256(data) !== digest
    ) {
        await cache.delete(cacheKey(url, digest));
        throw new Error(`${label} cache entry failed integrity verification`);
    }
    return data;
}

/** @param {Cache|null} cache @param {RuntimeAsset} asset @param {string} label */
async function loadVerifiedBytes(cache, asset, label) {
    const cached = await cachedBytes(
        cache,
        asset.url,
        asset.sha256,
        asset.size,
        label,
        asset.size,
    );
    if (cached) return cached;
    const data = await fetchBytes(asset.url, asset.size, label);
    if (data.byteLength !== asset.size) {
        throw new Error(`${label} size ${data.byteLength} does not match ${asset.size}`);
    }
    if (await sha256(data) !== asset.sha256) {
        throw new Error(`${label} SHA-256 verification failed`);
    }
    await cache?.put(cacheKey(asset.url, asset.sha256), new Response(data));
    return data;
}

/**
 * @param {string} manifestUrl
 * @param {string[]} allowedOrigins
 * @param {Cache|null} cache
 * @returns {Promise<LoadedManifest>}
 */
async function loadRemoteManifest(manifestUrl, allowedOrigins, cache) {
    const url = validateUrl(manifestUrl, allowedOrigins, 'Runtime manifest');
    const bytes = await fetchBytes(url, MAX_MANIFEST_BYTES, 'Runtime manifest');
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (error) {
        throw new Error(`Runtime manifest JSON is invalid: ${errorMessage(error)}`);
    }
    const manifest = validateManifest(parsed, url, allowedOrigins);
    const digest = await sha256(bytes);
    await cache?.put(cacheKey(url.href, digest), new Response(bytes));
    return { manifest, manifestUrl: url.href, manifestDigest: digest };
}

/**
 * @param {LastKnownGoodRecord} record
 * @param {string[]} allowedOrigins
 * @param {Cache|null} cache
 * @returns {Promise<LoadedManifest>}
 */
async function loadCachedManifest(record, allowedOrigins, cache) {
    if (!record || typeof record !== 'object') {
        throw new Error('Last-known-good runtime metadata is invalid');
    }
    validateDigest(record.manifestDigest, 'Last-known-good manifest');
    const manifestUrl = validateUrl(
        record.manifestUrl,
        allowedOrigins,
        'Last-known-good manifest',
    );
    const bytes = await cachedBytes(
        cache,
        manifestUrl.href,
        record.manifestDigest,
        MAX_MANIFEST_BYTES,
        'Last-known-good manifest',
    );
    if (!bytes) throw new Error('Last-known-good manifest is not cached');
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (error) {
        throw new Error(`Last-known-good manifest JSON is invalid: ${errorMessage(error)}`);
    }
    const manifest = validateManifest(parsed, manifestUrl, allowedOrigins);
    if (manifest.runtimeId !== record.runtimeId) {
        throw new Error('Last-known-good runtime identity does not match its manifest');
    }
    return {
        manifest,
        manifestUrl: manifestUrl.href,
        manifestDigest: record.manifestDigest,
    };
}

/**
 * @param {'remote'|'last-known-good'} source
 * @param {LoadedManifest} loadedManifest
 * @param {string[]} allowedOrigins
 * @param {Cache|null} cache
 * @returns {Promise<WorkerRuntimeCandidate & {
 *   _manifestUrl: string, _manifestDigest: string}>}
 */
async function prepareCandidate(source, loadedManifest, allowedOrigins, cache) {
    const workerBytes = await loadVerifiedBytes(
        cache,
        loadedManifest.manifest.worker,
        'Runtime worker',
    );
    const workerUrl = URL.createObjectURL(
        new Blob([workerBytes], { type: 'application/javascript' }),
    );
    return {
        workerUrl,
        source,
        runtimeId: loadedManifest.manifest.runtimeId,
        manifest: loadedManifest.manifest,
        stubPackageCatalog: {
            ...loadedManifest.manifest.catalog,
            allowedOrigins,
        },
        _manifestUrl: loadedManifest.manifestUrl,
        _manifestDigest: loadedManifest.manifestDigest,
    };
}

/** @param {string} storageKey @returns {LastKnownGoodRecord|null} */
function readLastKnownGood(storageKey) {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(storageKey);
    if (!value) return null;
    try {
        return /** @type {LastKnownGoodRecord} */ (JSON.parse(value));
    } catch {
        throw new Error('Last-known-good runtime metadata is invalid JSON');
    }
}

/**
 * @param {string} storageKey
 * @param {WorkerRuntimeCandidate & {_manifestUrl?: string, _manifestDigest?: string}} candidate
 */
function markLastKnownGood(storageKey, candidate) {
    if (candidate.source === 'bundled' || typeof localStorage === 'undefined') return;
    localStorage.setItem(storageKey, JSON.stringify({
        manifestUrl: candidate._manifestUrl,
        manifestDigest: candidate._manifestDigest,
        runtimeId: candidate.runtimeId,
    }));
}

/**
 * Start the selected runtime with last-known-good and bundled fallback.
 *
 * The callback owns startup validation. A candidate is recorded as
 * last-known-good only after the callback resolves.
 *
 * @template T
 * @param {WorkerRuntimeOptions} options - Runtime selection policy.
 * @param {(candidate: WorkerRuntimeCandidate) => Promise<T>} start - Starts and
 *   validates one candidate.
 * @returns {Promise<WorkerRuntimeResult<T>>} Successful value and selection data.
 */
export async function startWorkerRuntime(options, start) {
    if (!options?.bundledWorkerUrl) {
        throw new TypeError('startWorkerRuntime requires options.bundledWorkerUrl');
    }
    if (typeof start !== 'function') {
        throw new TypeError('startWorkerRuntime requires a start callback');
    }
    if (!options.manifestUrl) {
        const value = await start({
            workerUrl: options.bundledWorkerUrl,
            source: 'bundled',
            runtimeId: 'bundled',
            manifest: null,
            stubPackageCatalog: undefined,
        });
        return {
            value,
            source: 'bundled',
            runtimeId: 'bundled',
            manifest: null,
            fallbacks: [],
        };
    }

    const allowedOrigins = options.allowedOrigins || [];
    if (
        allowedOrigins.length === 0
        || allowedOrigins.length > 16
        || !allowedOrigins.every((origin) => typeof origin === 'string')
    ) {
        throw new TypeError('Runtime allowedOrigins must contain between 1 and 16 origins');
    }
    if (allowedOrigins.some((origin) => {
        try {
            return new URL(origin).origin !== origin;
        } catch {
            return true;
        }
    })) {
        throw new TypeError('Runtime allowedOrigins entries must be absolute origins');
    }
    const cacheName = options.cacheName || DEFAULT_CACHE_NAME;
    const storageKey = options.storageKey
        || `${DEFAULT_STORAGE_KEY}:${new URL(options.manifestUrl).href}`;
    const cache = await openRuntimeCache(cacheName);
    /** @type {RuntimeFallback[]} */
    const fallbacks = [];
    let remoteRuntimeId = null;

    try {
        const loaded = await loadRemoteManifest(options.manifestUrl, allowedOrigins, cache);
        remoteRuntimeId = loaded.manifest.runtimeId;
        const candidate = await prepareCandidate('remote', loaded, allowedOrigins, cache);
        try {
            const value = await start(candidate);
            try {
                markLastKnownGood(storageKey, candidate);
            } catch (error) {
                fallbacks.push({
                    source: 'remote',
                    error: `Last-known-good metadata was not persisted: ${errorMessage(error)}`,
                });
            }
            return {
                value,
                source: 'remote',
                runtimeId: candidate.runtimeId,
                manifest: candidate.manifest,
                fallbacks,
            };
        } catch (error) {
            fallbacks.push({ source: 'remote', error: errorMessage(error) });
        } finally {
            URL.revokeObjectURL(candidate.workerUrl);
        }
    } catch (error) {
        fallbacks.push({ source: 'remote', error: errorMessage(error) });
    }

    try {
        const record = readLastKnownGood(storageKey);
        if (record?.runtimeId && record.runtimeId !== remoteRuntimeId) {
            const loaded = await loadCachedManifest(record, allowedOrigins, cache);
            const candidate = await prepareCandidate(
                'last-known-good',
                loaded,
                allowedOrigins,
                cache,
            );
            try {
                const value = await start(candidate);
                return {
                    value,
                    source: 'last-known-good',
                    runtimeId: candidate.runtimeId,
                    manifest: candidate.manifest,
                    fallbacks,
                };
            } catch (error) {
                fallbacks.push({ source: 'last-known-good', error: errorMessage(error) });
            } finally {
                URL.revokeObjectURL(candidate.workerUrl);
            }
        }
    } catch (error) {
        fallbacks.push({ source: 'last-known-good', error: errorMessage(error) });
    }

    try {
        const value = await start({
            workerUrl: options.bundledWorkerUrl,
            source: 'bundled',
            runtimeId: 'bundled',
            manifest: null,
            stubPackageCatalog: undefined,
        });
        return {
            value,
            source: 'bundled',
            runtimeId: 'bundled',
            manifest: null,
            fallbacks,
        };
    } catch (error) {
        fallbacks.push({ source: 'bundled', error: errorMessage(error) });
        throw new Error(
            `Unable to start any Pyright worker runtime: ${fallbacks
                .map((failure) => `${failure.source}: ${failure.error}`)
                .join('; ')}`,
        );
    }
}
