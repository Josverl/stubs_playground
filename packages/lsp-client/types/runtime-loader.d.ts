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
export function startWorkerRuntime<T>(options: WorkerRuntimeOptions, start: (candidate: WorkerRuntimeCandidate) => Promise<T>): Promise<WorkerRuntimeResult<T>>;
export type RuntimeSource = "remote" | "last-known-good" | "bundled";
export type RuntimeFallback = {
    source: "remote" | "last-known-good" | "bundled";
    error: string;
};
export type WorkerRuntimeOptions = {
    /**
     * - Deterministic same-origin fallback worker.
     */
    bundledWorkerUrl: string;
    /**
     * - Optional remote runtime manifest URL.
     */
    manifestUrl?: string;
    /**
     * - Origins permitted for the manifest and
     * every asset URL it contains.
     */
    allowedOrigins?: string[];
    /**
     * - Cache Storage namespace.
     */
    cacheName?: string;
    /**
     * - localStorage key for last-known-good metadata.
     */
    storageKey?: string;
};
export type WorkerRuntimeCandidate = {
    /**
     * - Verified Blob URL or bundled worker URL.
     */
    workerUrl: string;
    /**
     * - Candidate origin in the fallback chain.
     */
    source: RuntimeSource;
    /**
     * - Immutable runtime identity, or `bundled`.
     */
    runtimeId: string;
    /**
     * - Validated runtime manifest.
     */
    manifest: Object | null;
    stubPackageCatalog: {
        url: string;
        size: number;
        sha256: string;
        allowedOrigins: string[];
    } | undefined;
};
export type RuntimeAsset = {
    url: string;
    size: number;
    sha256: string;
};
export type RuntimeTypeshed = RuntimeAsset & {
    identity: string;
};
export type RuntimeCatalog = RuntimeAsset & {
    schemaVersion: "2.0";
};
export type RuntimeFallbackArchive = RuntimeAsset & {
    id: string;
    packageName: string;
    packageVersion: string;
};
export type RuntimeManifest = {
    $schema: "runtime-manifest.schema.json";
    schemaVersion: 1;
    runtimeId: string;
    package: {
        name: string;
        version: string;
    };
    worker: RuntimeAsset;
    pyrightVersion: string;
    typeshed: RuntimeTypeshed;
    controlProtocol: {
        minimumVersion: number;
        maximumVersion: number;
        capabilities: string[];
    };
    catalog: RuntimeCatalog;
    fallbackArchives: RuntimeFallbackArchive[];
};
export type LoadedManifest = {
    manifest: RuntimeManifest;
    manifestUrl: string;
    manifestDigest: string;
};
export type LastKnownGoodRecord = {
    manifestUrl: string;
    manifestDigest: string;
    runtimeId: string;
};
export type WorkerRuntimeResult<T> = {
    /**
     * - Value returned by the successful start callback.
     */
    value: T;
    /**
     * - Successful runtime source.
     */
    source: RuntimeSource;
    /**
     * - Successful immutable runtime identity.
     */
    runtimeId: string;
    /**
     * - Earlier rejected candidates.
     */
    fallbacks: RuntimeFallback[];
};
