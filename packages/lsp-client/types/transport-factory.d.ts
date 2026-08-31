/**
 * Create an LSP transport.
 *
 * @param {Object} options - Worker initialization options.
 * @param {string} options.workerUrl - Worker script or Blob URL.
 * @param {ArrayBuffer|false} [options.boardStubs] - Board-specific stubs zip.
 *   `false` or omission disables board stubs unless another source is selected.
 * @param {string} [options.boardStubsUrl] - Absolute fallback archive URL.
 * @param {{url?: string, data?: ArrayBuffer, size: number, sha256: string,
 *   allowedOrigins?: string[]}} [options.boardStubsArchive] - Verified board archive.
 * @param {{url?: string, data?: ArrayBuffer, size: number, sha256: string,
 *   allowedOrigins?: string[]}} [options.stubPackageCatalog] - Verified catalog.
 * @param {{packageName: string, version?: string, fallbackToBundled?: boolean}} [options.boardStubPackage] -
 *   Cached PyPI package to use as `/typings`.
 * @param {Object.<string, string>} [options.workspaceFiles] - Project files to
 *   preload into `/workspace`, keyed by workspace-relative path.
 * @param {string} [options.typeCheckingMode] - Pyright type-checking mode.
 * @param {string} [options.typeshedPath] - Absolute worker-VFS typeshed path.
 * @param {string} [options.pythonVersion] - Python version in `X.Y` format.
 * @param {boolean} [options.verboseOutput] - Enable verbose Pyright output.
 * @param {Array<{packageName: string, files: Object.<string, string>}>}
 *   [options.extraStubPackages] - Additional type-only stub packages.
 * @param {Array<{packageName: string, archive: {url?: string,
 *   data?: ArrayBuffer, size: number, sha256: string, allowedOrigins?: string[]}}>}
 *   [options.extraStubArchives] - Verified type-only ZIP archives.
 * @param {string[]} [options.extraPaths] - Absolute extra import search paths.
 * @param {number} [options.initializationTimeout=120000] - Worker init timeout.
 * @returns {WorkerTransport} Unconnected worker transport.
 * @throws {TypeError} If `options.workerUrl` is missing.
 */
export function createTransport(options: {
    workerUrl: string;
    boardStubs?: ArrayBuffer | false;
    boardStubsUrl?: string;
    boardStubsArchive?: {
        url?: string;
        data?: ArrayBuffer;
        size: number;
        sha256: string;
        allowedOrigins?: string[];
    };
    stubPackageCatalog?: {
        url?: string;
        data?: ArrayBuffer;
        size: number;
        sha256: string;
        allowedOrigins?: string[];
    };
    boardStubPackage?: {
        packageName: string;
        version?: string;
        fallbackToBundled?: boolean;
    };
    workspaceFiles?: {
        [x: string]: string;
    };
    typeCheckingMode?: string;
    typeshedPath?: string;
    pythonVersion?: string;
    verboseOutput?: boolean;
    extraStubPackages?: Array<{
        packageName: string;
        files: {
            [x: string]: string;
        };
    }>;
    extraStubArchives?: Array<{
        packageName: string;
        archive: {
            url?: string;
            data?: ArrayBuffer;
            size: number;
            sha256: string;
            allowedOrigins?: string[];
        };
    }>;
    extraPaths?: string[];
    initializationTimeout?: number;
}): WorkerTransport;
import { WorkerTransport } from './worker-transport.js';
