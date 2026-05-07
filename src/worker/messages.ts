/** Message types for main thread ↔ worker communication */

export interface UserFolder {
    [key: string]: UserFolder | string | ArrayBuffer;
}

export interface MsgServerLoaded {
    type: "serverLoaded";
}

export interface MsgInitServer {
    type: "initServer";
    /** User type stubs as nested folder structure */
    userFiles: UserFolder;
    /** Project files written into /workspace before Pyright starts */
    workspaceFiles?: Record<string, string>;
    /** Legacy custom typeshed override (unused by current worker implementation) */
    typeshedFallback?: ArrayBuffer | false | undefined;
    /** Board stubs zip (ArrayBuffer), or false to skip, or undefined to use bundled default */
    boardStubs: ArrayBuffer | false | undefined;
    /** Pyright type checking mode: off, basic, standard, strict */
    typeCheckingMode?: string;
    /** Pyright typeshedPath, e.g. /typeshed-micropython or /typeshed-fallback */
    typeshedPath?: string;
    /** Pyright pythonVersion in X.Y format */
    pythonVersion?: string;
    /** Pyright verboseOutput */
    verboseOutput?: boolean;
}

export interface MsgServerInitialized {
    type: "serverInitialized";
    pyrightVersion: string;
}

export interface MsgServerError {
    type: "serverError";
    error: string;
}

export interface MsgSyncFile {
    type: "syncFile";
    /** File path relative to /workspace (e.g. "helpers.py" or "lib/utils.py") */
    path: string;
    /** File text content */
    content: string;
}

export interface MsgDeleteFile {
    type: "deleteFile";
    /** File path relative to /workspace */
    path: string;
}

export interface MsgDebugListFs {
    type: "debugListFs";
    /** Correlation id for matching request/response */
    requestId: string;
    /** Root path to inspect, e.g. /typings or /workspace */
    root?: string;
    /** Max depth from root. 0 means root only. */
    depth?: number;
}

export interface MsgDebugListFsResult {
    type: "debugListFsResult";
    requestId: string;
    ok: boolean;
    root: string;
    entries: Array<{
        path: string;
        kind: "file" | "dir";
        depth: number;
        size?: number;
    }>;
    error?: string;
}

export type WorkerMessage =
    | MsgServerLoaded
    | MsgInitServer
    | MsgServerInitialized
    | MsgServerError
    | MsgSyncFile
    | MsgDeleteFile
    | MsgDebugListFs
    | MsgDebugListFsResult;
