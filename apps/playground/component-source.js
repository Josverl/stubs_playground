import { componentConfig } from './component-config.generated.js';

const params = new URLSearchParams(window.location.search);
const requestedSource = params.get('components') || 'local';
if (!['local', 'cdn'].includes(requestedSource)) {
    throw new Error(`Invalid component source "${requestedSource}"; expected "local" or "cdn"`);
}

const cdnUrl = (tag, path) =>
    `https://cdn.jsdelivr.net/gh/${componentConfig.repository}@${tag}/${path}`;

const sourceConfig = requestedSource === 'cdn'
    ? {
        clientUrl: cdnUrl(componentConfig.lspClient.tag, componentConfig.lspClient.entry),
        workerUrl: cdnUrl(
            componentConfig.pyrightWorker.tag,
            componentConfig.pyrightWorker.worker,
        ),
        assetsBase: cdnUrl(
            componentConfig.pyrightWorker.tag,
            componentConfig.pyrightWorker.assets,
        ),
        clientVersion: componentConfig.lspClient.tag,
        workerVersion: componentConfig.pyrightWorker.tag,
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

export const { lintKeymapExtension } = lsp;

export const componentSource = Object.freeze({
    mode: requestedSource,
    ...sourceConfig,
});

export const componentAssetsBase = sourceConfig.assetsBase;
export const getWorkerUrl = resolveWorkerUrl;

window.__componentSource = componentSource;
