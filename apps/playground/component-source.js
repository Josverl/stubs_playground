import { componentConfig } from './component-config.generated.js';

const params = new URLSearchParams(window.location.search);
const sourceParam = params.get('components') || 'local';
const requestedSource = sourceParam === 'cdn' ? 'npm' : sourceParam;
if (!['local', 'npm'].includes(requestedSource)) {
    throw new Error(`Invalid component source "${sourceParam}"; expected "local" or "npm"`);
}

const npmUrl = ({ packageName, version }, path) =>
    `https://cdn.jsdelivr.net/npm/${packageName}@${version}/${path}`;

const sourceConfig = requestedSource === 'npm'
    ? {
        clientUrl: npmUrl(componentConfig.lspClient, componentConfig.lspClient.entry),
        workerUrl: npmUrl(
            componentConfig.pyrightWorker,
            componentConfig.pyrightWorker.worker,
        ),
        assetsBase: npmUrl(
            componentConfig.pyrightWorker,
            componentConfig.pyrightWorker.assets,
        ),
        clientVersion: componentConfig.lspClient.version,
        workerVersion: componentConfig.pyrightWorker.version,
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
