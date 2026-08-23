/**
 * Convert LSP CompletionItemKind to CodeMirror completion type.
 *
 * @param {number|undefined} kind - LSP completion kind.
 * @returns {string} CodeMirror completion type name.
 */
export function kindToType(kind: number | undefined): string;
/**
 * Check whether a completion label is a Python dunder name.
 *
 * @param {unknown} label - Completion label candidate.
 * @returns {boolean} Whether the label starts and ends with two underscores.
 */
export function isDunderLabel(label: unknown): boolean;
/**
 * Convert LSP CompletionItem to CodeMirror completion option.
 *
 * @param {LSPCompletionItem} item - LSP completion item.
 * @returns {CodeMirrorCompletionOption} Normalized CodeMirror option.
 */
export function convertCompletionItem(item: LSPCompletionItem): CodeMirrorCompletionOption;
/**
 * Compute the CodeMirror replacement start for a matched completion token.
 *
 * For dotted access, only the suffix after the final dot is replaced.
 *
 * @param {{text: string, from: number}} word - CodeMirror token match.
 * @returns {number} Absolute document offset at which replacement begins.
 */
export function computeCompletionFrom(word: {
    text: string;
    from: number;
}): number;
/**
 * Deduplicate completion options and return them sorted by relevance.
 *
 * @param {CodeMirrorCompletionOption[]} options - Completion options to normalize.
 * @returns {CodeMirrorCompletionOption[]} New deduplicated, ranked array.
 */
export function dedupeAndSortCompletionOptions(options: CodeMirrorCompletionOption[]): CodeMirrorCompletionOption[];
/**
 * Pure completion helpers shared by runtime code and unit tests.
 */
/**
 * @typedef {Object} LSPCompletionItem
 * @property {string} label - Display label.
 * @property {number} [kind] - LSP `CompletionItemKind`.
 * @property {string} [detail] - Additional signature/type detail.
 * @property {string|{value: string}} [documentation] - Plain or markup documentation.
 * @property {string} [insertText] - Text inserted when selected.
 * @property {boolean} [preselect] - Whether the server prefers this item.
 */
/**
 * @typedef {Object} CodeMirrorCompletionOption
 * @property {string} label - Display label.
 * @property {string} type - CodeMirror completion icon/type name.
 * @property {string} detail - Additional signature/type detail.
 * @property {string} info - Documentation text.
 * @property {string} apply - Text inserted when selected.
 * @property {number} boost - Relative ranking boost.
 */
/**
 * LSP `CompletionItemKind` numeric constants.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const CompletionItemKind: Readonly<Record<string, number>>;
export type LSPCompletionItem = {
    /**
     * - Display label.
     */
    label: string;
    /**
     * - LSP `CompletionItemKind`.
     */
    kind?: number;
    /**
     * - Additional signature/type detail.
     */
    detail?: string;
    /**
     * - Plain or markup documentation.
     */
    documentation?: string | {
        value: string;
    };
    /**
     * - Text inserted when selected.
     */
    insertText?: string;
    /**
     * - Whether the server prefers this item.
     */
    preselect?: boolean;
};
export type CodeMirrorCompletionOption = {
    /**
     * - Display label.
     */
    label: string;
    /**
     * - CodeMirror completion icon/type name.
     */
    type: string;
    /**
     * - Additional signature/type detail.
     */
    detail: string;
    /**
     * - Documentation text.
     */
    info: string;
    /**
     * - Text inserted when selected.
     */
    apply: string;
    /**
     * - Relative ranking boost.
     */
    boost: number;
};
