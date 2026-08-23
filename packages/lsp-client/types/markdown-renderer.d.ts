/**
 * Process inline text formatting into a DocumentFragment.
 *
 * Handles (in priority order):
 *   - RST substitution references      |see_cpython_module|, etc.
 *   - RST double-backtick inline code  ``code``
 *   - RST interpreted roles            :func:`name`, :class:`Pin`, etc.
 *   - Markdown bold                    **text**
 *   - Markdown italic                  *text*
 *   - Markdown / RST inline code       `code`
 *   - Markdown links                   [label](url)
 *   - Bare URLs                        https://...
 *
 * @param {string} text - Raw inline text
 * @returns {DocumentFragment}
 */
export function processInline(text: string): DocumentFragment;
/**
 * Render block-level Markdown + RST content into a container element.
 *
 * Handles:
 *   - ATX headers          # H1 … ###### H6
 *   - Setext headers       text\n=== or text\n---
 *   - Horizontal rules     ---, ***, ___
 *   - Fenced code blocks   ```lang … ```  (handled by caller)
 *   - RST code blocks      paragraph ending with :: + indented block
 *   - RST grid tables      +---+---+ separated rows with | cells |
 *   - RST field lists      :param name:, :returns:, :rtype:, :raises:
 *   - Bullet lists         -, *, +
 *   - Numbered lists       1. 2. …
 *   - Regular paragraphs   (soft-wrapped)
 *
 * @param {string} text
 * @param {HTMLElement} container
 * @returns {void}
 */
export function renderBlocks(text: string, container: HTMLElement): void;
/**
 * Render a Markdown string (with embedded RST markup) to an HTML element.
 *
 * Fenced code blocks are extracted first; the remaining text is passed to
 * renderBlocks() for block-level processing.
 *
 * @param {string} text - Raw markdown / RST text
 * @returns {HTMLElement} A div element containing rendered HTML
 */
export function renderMarkdown(text: string): HTMLElement;
/**
 * Markdown / RST Renderer for CodeMirror
 *
 * Pure rendering utilities for converting Markdown and RST text to DOM elements.
 * No dependencies on CodeMirror or LSP client — can be used standalone.
 *
 * Handles:
 *   - Markdown: headers, lists, code blocks, links, bold/italic
 *   - RST: inline roles, code blocks with ::, field lists
 *   - Pyright signatures: type annotations prefixed with (type) tags
 */
/**
 * Regex pattern for Pyright type/signature declarations.
 * Matches "(module)", "(class)", "(function)", etc., or bare "class Foo" / "def foo".
 * @type {RegExp}
 */
export const PYRIGHT_SIG_RE: RegExp;
