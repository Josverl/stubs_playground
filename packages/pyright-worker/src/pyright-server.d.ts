import type { Connection } from "vscode-languageserver";

export declare class PyrightServer {
    constructor(connection: Connection, maxWorkers: number);
}