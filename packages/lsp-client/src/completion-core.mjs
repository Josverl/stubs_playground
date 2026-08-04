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
export const CompletionItemKind = {
    Text: 1,
    Method: 2,
    Function: 3,
    Constructor: 4,
    Field: 5,
    Variable: 6,
    Class: 7,
    Interface: 8,
    Module: 9,
    Property: 10,
    Unit: 11,
    Value: 12,
    Enum: 13,
    Keyword: 14,
    Snippet: 15,
    Color: 16,
    File: 17,
    Reference: 18,
    Folder: 19,
    EnumMember: 20,
    Constant: 21,
    Struct: 22,
    Event: 23,
    Operator: 24,
    TypeParameter: 25,
};

const LSP_BASE_BOOST = 99;
const PRESELECT_BONUS = 10;
const DUNDER_PENALTY = 120;

/**
 * Convert LSP CompletionItemKind to CodeMirror completion type.
 *
 * @param {number|undefined} kind - LSP completion kind.
 * @returns {string} CodeMirror completion type name.
 */
export function kindToType(kind) {
    switch (kind) {
        case CompletionItemKind.Method:
        case CompletionItemKind.Function:
        case CompletionItemKind.Constructor:
            return 'function';
        case CompletionItemKind.Field:
        case CompletionItemKind.Property:
            return 'property';
        case CompletionItemKind.Variable:
        case CompletionItemKind.Constant:
            return 'variable';
        case CompletionItemKind.Class:
        case CompletionItemKind.Interface:
        case CompletionItemKind.Struct:
            return 'class';
        case CompletionItemKind.Module:
            return 'namespace';
        case CompletionItemKind.Keyword:
            return 'keyword';
        case CompletionItemKind.Enum:
        case CompletionItemKind.EnumMember:
            return 'enum';
        case CompletionItemKind.TypeParameter:
            return 'type';
        default:
            return 'text';
    }
}

/**
 * Check whether a completion label is a Python dunder name.
 *
 * @param {unknown} label - Completion label candidate.
 * @returns {boolean} Whether the label starts and ends with two underscores.
 */
export function isDunderLabel(label) {
    return typeof label === 'string' && /^__.+__$/.test(label);
}

function docToInfo(documentation) {
    if (!documentation) return '';
    if (typeof documentation === 'string') return documentation;
    return documentation.value || '';
}

/**
 * Convert LSP CompletionItem to CodeMirror completion option.
 *
 * @param {LSPCompletionItem} item - LSP completion item.
 * @returns {CodeMirrorCompletionOption} Normalized CodeMirror option.
 */
export function convertCompletionItem(item) {
    const base = LSP_BASE_BOOST + (item.preselect ? PRESELECT_BONUS : 0);
    const penalty = isDunderLabel(item.label) ? DUNDER_PENALTY : 0;

    return {
        label: item.label,
        type: kindToType(item.kind),
        detail: item.detail || '',
        info: docToInfo(item.documentation),
        apply: item.insertText || item.label,
        boost: base - penalty,
    };
}

/**
 * Compute the CodeMirror replacement start for a matched completion token.
 *
 * For dotted access, only the suffix after the final dot is replaced.
 *
 * @param {{text: string, from: number}} word - CodeMirror token match.
 * @returns {number} Absolute document offset at which replacement begins.
 */
export function computeCompletionFrom(word) {
    const dotIndex = word.text.lastIndexOf('.');
    return dotIndex >= 0 ? word.from + dotIndex + 1 : word.from;
}

function completionKey(option) {
    return `${option.label || ''}\u0000${option.apply || option.label || ''}`;
}

function infoLength(option) {
    if (!option.info) return 0;
    return String(option.info).length;
}

function compareOptions(a, b) {
    const boostA = a.boost || 0;
    const boostB = b.boost || 0;
    if (boostA !== boostB) return boostB - boostA;

    const detailA = a.detail ? 1 : 0;
    const detailB = b.detail ? 1 : 0;
    if (detailA !== detailB) return detailB - detailA;

    const infoA = infoLength(a);
    const infoB = infoLength(b);
    if (infoA !== infoB) return infoB - infoA;

    return (a.label || '').localeCompare(b.label || '');
}

/**
 * Deduplicate completion options and return them sorted by relevance.
 *
 * @param {CodeMirrorCompletionOption[]} options - Completion options to normalize.
 * @returns {CodeMirrorCompletionOption[]} New deduplicated, ranked array.
 */
export function dedupeAndSortCompletionOptions(options) {
    const bestByKey = new Map();

    for (const option of options) {
        const key = completionKey(option);
        const current = bestByKey.get(key);
        if (!current || compareOptions(option, current) < 0) {
            bestByKey.set(key, option);
        }
    }

    return [...bestByKey.values()].sort(compareOptions);
}
