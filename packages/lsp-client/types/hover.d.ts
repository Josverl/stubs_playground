/**
 * Create LSP hover tooltip source for CodeMirror
 *
 * @param {import('./simple-client.js').SimpleLSPClient} lspClient - Connected LSP client.
 * @param {string} documentUri - The document URI
 * @returns {import('@codemirror/state').Extension} CodeMirror hover extension.
 *   LSP request and stale-position errors are logged and produce no tooltip.
 */
export function createHoverTooltip(lspClient: import("./simple-client.js").SimpleLSPClient, documentUri: string): import("@codemirror/state").Extension;
export { renderMarkdown } from "./markdown-renderer.js";
export type LSPPosition = {
    /**
     * - Zero-based line.
     */
    line: number;
    /**
     * - Zero-based character offset.
     */
    character: number;
};
export type LSPHoverResult = {
    /**
     * - Hover markup.
     */
    contents?: string | {
        value?: string;
    } | Array<string | {
        value?: string;
    }>;
    /**
     * - Hovered source range.
     */
    range?: {
        start: LSPPosition;
        end: LSPPosition;
    };
};
