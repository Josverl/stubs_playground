const CDN_REPOSITORY = 'Josverl/stubs_playground';
const CDN_CLIENT_TAG = 'lsp-client-v0.1.0';
const CDN_WORKER_TAG = 'pyright-worker-v0.1.0';

const params = new URLSearchParams(window.location.search);
const requestedSource = params.get('components') || 'local';
if (!['local', 'cdn'].includes(requestedSource)) {
    throw new Error(`Invalid component source "${requestedSource}"; expected "local" or "cdn"`);
}

const cdnUrl = (tag, path) =>
    `https://cdn.jsdelivr.net/gh/${CDN_REPOSITORY}@${tag}/${path}`;

const sourceConfig = requestedSource === 'cdn'
    ? {
        clientUrl: cdnUrl(CDN_CLIENT_TAG, 'src/lsp/index.js'),
        workerUrl: cdnUrl(CDN_WORKER_TAG, 'dist/pyright_worker.js'),
        assetsBase: cdnUrl(CDN_WORKER_TAG, 'assets'),
        clientVersion: CDN_CLIENT_TAG,
        workerVersion: CDN_WORKER_TAG,
    }
    : {
        clientUrl: new URL('../../packages/lsp-client/src/index.js', import.meta.url).href,
        workerUrl: new URL(
            '../../packages/pyright-worker/dist/pyright_worker.js',
            import.meta.url,
        ).href,
        assetsBase: new URL('../../packages/pyright-worker/assets', import.meta.url).href
            .replace(/\/$/, ''),
        clientVersion: 'workspace',
        workerVersion: 'workspace',
    };

let workerObjectUrl;
function resolveWorkerUrl() {
    if (requestedSource === 'local') {
        return sourceConfig.workerUrl;
    }
    if (!workerObjectUrl) {
        const shim = `importScripts(${JSON.stringify(sourceConfig.workerUrl)});`;
        workerObjectUrl = URL.createObjectURL(
            new Blob([shim], { type: 'application/javascript' }),
        );
    }
    return workerObjectUrl;
}

const lsp = await import(sourceConfig.clientUrl);

export const {
    createLSPClient,
    createLSPPlugin,
    switchBoard,
    notifyDocumentChange,
    notifyDocumentOpen,
    removeWorkspaceDiagnosticsFor,
    getWorkspaceDiagnostics,
} = lsp;

// v0.1.0 did not yet expose this optional keymap from its public entry point.
export const lintKeymapExtension = lsp.lintKeymapExtension ?? [];

export const componentSource = Object.freeze({
    mode: requestedSource,
    ...sourceConfig,
});

export const componentAssetsBase = sourceConfig.assetsBase;
export const getWorkerUrl = resolveWorkerUrl;

window.__componentSource = componentSource;
