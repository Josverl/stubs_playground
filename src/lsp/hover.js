/**
 * LSP Hover Tooltip Implementation for CodeMirror
 *
 * Provides hover tooltips with type information and documentation from Pyright LSP.
 * Delegates Markdown/RST rendering to the separate markdown-renderer module.
 */

import { hoverTooltip } from '@codemirror/view';
import { renderMarkdown } from './markdown-renderer.js';

// Backward compatibility for existing hover rendering tests/imports.
export { renderMarkdown } from './markdown-renderer.js';

/**
 * Convert LSP Hover result to CodeMirror tooltip content.
 *
 * @param {Object} hover - LSP Hover result
 * @returns {HTMLElement|null} Tooltip DOM element
 */
function createHoverContent(hover) {
    if (!hover || !hover.contents) {
        return null;
    }

    const container = document.createElement('div');
    container.className = 'cm-lsp-hover';

    const content = hover.contents;

    if (typeof content === 'string') {
        container.appendChild(renderMarkdown(content));
    } else if (content.kind === 'markdown') {
        container.appendChild(renderMarkdown(content.value));
    } else if (content.kind === 'plaintext') {
        container.appendChild(renderMarkdown(content.value));
    } else if (Array.isArray(content)) {
        content.forEach(item => {
            if (typeof item === 'string') {
                container.appendChild(renderMarkdown(item));
            } else if (item.language) {
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                code.className = `language-${item.language}`;
                code.textContent = item.value;
                pre.appendChild(code);
                container.appendChild(pre);
            }
        });
    } else if (content.language) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = `language-${content.language}`;
        code.textContent = content.value;
        pre.appendChild(code);
        container.appendChild(pre);
    }

    return container.children.length > 0 ? container : null;
}

/**
 * Create LSP hover tooltip source for CodeMirror
 * 
 * @param {SimpleLSPClient} lspClient - The LSP client instance
 * @param {string} documentUri - The document URI
 * @returns {Function} CodeMirror hover tooltip source function
 */
export function createHoverTooltip(lspClient, documentUri) {
    return hoverTooltip(async (view, pos, side) => {
        console.log('LSP hover triggered at position:', pos);

        try {
            // Get line and character position
            const line = view.state.doc.lineAt(pos);
            const lineNumber = line.number - 1; // 0-based for LSP
            const character = pos - line.from;

            console.log(`LSP hover at line ${lineNumber + 1}, char ${character}`);

            // Send LSP hover request
            const result = await lspClient.request('textDocument/hover', {
                textDocument: { uri: documentUri },
                position: { line: lineNumber, character }
            });

            console.log('LSP hover result:', result);

            if (!result || !result.contents) {
                return null;
            }

            // Create tooltip content
            const content = createHoverContent(result);
            if (!content) {
                return null;
            }

            // Determine tooltip position range
            // Use the range from LSP if provided, otherwise use word boundaries
            let from = pos;
            let to = pos;

            if (result.range) {
                // Convert LSP range to CodeMirror positions
                const startLine = view.state.doc.line(result.range.start.line + 1);
                const endLine = view.state.doc.line(result.range.end.line + 1);
                from = startLine.from + result.range.start.character;
                to = endLine.from + result.range.end.character;
            } else {
                // Find word boundaries at cursor position
                const lineText = line.text;
                const wordMatch = /[\w\.]+/.exec(lineText.slice(0, character));
                if (wordMatch) {
                    from = line.from + character - wordMatch[0].length + wordMatch.index;
                    to = line.from + character;
                }
            }

            console.log(`Hover tooltip range: ${from} - ${to}`);

            return {
                pos: from,
                end: to,
                above: true,
                create: () => ({ dom: content })
            };

        } catch (error) {
            console.error('LSP hover error:', error);
            return null;
        }
    });
}
