/**
 * LSP Hover Tooltip Implementation for CodeMirror
 *
 * Provides hover tooltips with type information and documentation from Pyright LSP.
 * Renders Markdown content with RST role markup (as found in MicroPython doc-stubs).
 */

import { hoverTooltip } from '@codemirror/view';

/**
 * Process inline text formatting into a DocumentFragment.
 *
 * Handles (in priority order):
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
function processInline(text) {
    const fragment = document.createDocumentFragment();
    if (!text) return fragment;

    // Combined pattern – order of alternatives matters.
    // Groups: 1=rst-dbl-bt content, 2=rst-role content,
    //         3=bold content, 4=italic content, 5=code content,
    //         6=md-link text, 7=md-link url, 8=bare url
    // RST role syntax: :rolename:`content`  (colon after role name is required)
    const pattern = /``([^`]+)``|:(?:func|class|meth|attr|mod|const|data|exc|obj|ref|doc):`([^`]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>")\]]+)/g;

    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        if (match[1] !== undefined) {
            // RST double-backtick inline code: ``code``
            const code = document.createElement('code');
            code.textContent = match[1];
            fragment.appendChild(code);
        } else if (match[2] !== undefined) {
            // RST role :role:`text`
            const code = document.createElement('code');
            code.className = 'cm-hover-rst-ref';
            code.textContent = match[2];
            fragment.appendChild(code);
        } else if (match[3] !== undefined) {
            // Bold **text**
            const strong = document.createElement('strong');
            strong.textContent = match[3];
            fragment.appendChild(strong);
        } else if (match[4] !== undefined) {
            // Italic *text*
            const em = document.createElement('em');
            em.textContent = match[4];
            fragment.appendChild(em);
        } else if (match[5] !== undefined) {
            // Inline code `text`
            const code = document.createElement('code');
            code.textContent = match[5];
            fragment.appendChild(code);
        } else if (match[6] !== undefined) {
            // Markdown link [label](url)
            const a = document.createElement('a');
            a.href = match[7];
            a.textContent = match[6];
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            fragment.appendChild(a);
        } else if (match[8] !== undefined) {
            // Bare URL
            const a = document.createElement('a');
            a.href = match[8];
            a.textContent = match[8];
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            fragment.appendChild(a);
        }

        lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    return fragment;
}

/**
 * Render block-level Markdown + RST content into a container element.
 *
 * Handles:
 *   - ATX headers          # H1 … ###### H6
 *   - Setext headers       text\n=== or text\n---
 *   - Horizontal rules     ---, ***, ___
 *   - Fenced code blocks   ```lang … ```  (handled by caller)
 *   - RST code blocks      paragraph ending with :: + indented block
 *   - RST field lists      :param name:, :returns:, :rtype:, :raises:
 *   - Bullet lists         -, *, +
 *   - Numbered lists       1. 2. …
 *   - Regular paragraphs   (soft-wrapped)
 *
 * @param {string} text
 * @param {HTMLElement} container
 */
function renderBlocks(text, container) {
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
        const raw = lines[i];
        const trimmed = raw.trimEnd();

        // Skip blank lines between blocks
        if (!trimmed.trim()) {
            i++;
            continue;
        }

        // ── ATX headers: # H1 … ###### H6 ────────────────────────────────────
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            const level = Math.min(headerMatch[1].length, 6);
            const heading = document.createElement(`h${level}`);
            heading.appendChild(processInline(headerMatch[2]));
            container.appendChild(heading);
            i++;
            continue;
        }

        // ── Setext headers: text\n=== or text\n--- ────────────────────────────
        if (i + 1 < lines.length) {
            const next = lines[i + 1].trimEnd();
            if (/^={3,}$/.test(next)) {
                const h = document.createElement('h1');
                h.appendChild(processInline(trimmed));
                container.appendChild(h);
                i += 2;
                continue;
            }
            if (/^-{3,}$/.test(next) && trimmed.trim()) {
                const h = document.createElement('h2');
                h.appendChild(processInline(trimmed));
                container.appendChild(h);
                i += 2;
                continue;
            }
        }

        // ── Horizontal rule: ---, ***, ___ ────────────────────────────────────
        if (/^[-*_]{3,}$/.test(trimmed.trim())) {
            container.appendChild(document.createElement('hr'));
            i++;
            continue;
        }

        // ── RST field list: :param …:, :returns:, :rtype:, :raises …: ─────────
        if (/^:(param|type|returns?|rtype|raises?|var|ivar|cvar)\b/.test(trimmed)) {
            const dl = document.createElement('dl');
            dl.className = 'cm-hover-fields';

            while (i < lines.length) {
                const fl = lines[i].trimEnd();
                if (!fl.trim()) { i++; break; }
                const fm = fl.match(/^:(param|type|returns?|rtype|raises?|var|ivar|cvar)\s*([^:]*):\s*(.*)/);
                if (!fm) break;

                const dt = document.createElement('dt');
                dt.className = 'cm-hover-field-name';
                dt.textContent = fm[2].trim() ? `${fm[1]} ${fm[2].trim()}` : fm[1];

                const dd = document.createElement('dd');
                let ddText = fm[3];
                i++;
                while (i < lines.length && /^\s{2,}/.test(lines[i]) && lines[i].trim()) {
                    ddText += ' ' + lines[i].trim();
                    i++;
                }
                dd.appendChild(processInline(ddText));
                dl.appendChild(dt);
                dl.appendChild(dd);
            }

            container.appendChild(dl);
            continue;
        }

        // ── RST code block: line ending with :: ───────────────────────────────
        if (trimmed.endsWith('::')) {
            const introText = trimmed.slice(0, -2).trimEnd();
            if (introText) {
                const p = document.createElement('p');
                p.appendChild(processInline(introText + ':'));
                container.appendChild(p);
            }
            i++;

            // Skip blank separator lines
            while (i < lines.length && !lines[i].trim()) i++;

            // Determine indentation of the code block
            let indent = 4;
            if (i < lines.length) {
                const indentMatch = lines[i].match(/^(\s+)/);
                indent = indentMatch ? indentMatch[1].length : 4;
            }

            const codeLines = [];
            while (i < lines.length) {
                const cl = lines[i];
                if (!cl.trim()) {
                    // Keep blank lines inside code block if more indented code follows
                    let j = i + 1;
                    while (j < lines.length && !lines[j].trim()) j++;
                    if (j < lines.length && /^\s/.test(lines[j])) {
                        codeLines.push('');
                        i++;
                    } else {
                        break;
                    }
                } else if (cl.length >= indent && cl.slice(0, indent).trim() === '') {
                    codeLines.push(cl.slice(indent));
                    i++;
                } else {
                    break;
                }
            }

            while (codeLines.length > 0 && !codeLines[codeLines.length - 1].trim()) {
                codeLines.pop();
            }

            if (codeLines.length > 0) {
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                code.textContent = codeLines.join('\n');
                pre.appendChild(code);
                container.appendChild(pre);
            }
            continue;
        }

        // ── Bullet list: -, *, + ───────────────────────────────────────────────
        if (/^[\-*+]\s+\S/.test(trimmed)) {
            const ul = document.createElement('ul');
            while (i < lines.length) {
                const il = lines[i].trimEnd();
                if (!il.trim()) break;
                const im = il.match(/^[\-*+]\s+(.+)$/);
                if (!im) break;
                const li = document.createElement('li');
                li.appendChild(processInline(im[1]));
                ul.appendChild(li);
                i++;
            }
            container.appendChild(ul);
            continue;
        }

        // ── Numbered list: 1. 2. … ────────────────────────────────────────────
        if (/^\d+\.\s+\S/.test(trimmed)) {
            const ol = document.createElement('ol');
            while (i < lines.length) {
                const il = lines[i].trimEnd();
                if (!il.trim()) break;
                const im = il.match(/^\d+\.\s+(.+)$/);
                if (!im) break;
                const li = document.createElement('li');
                li.appendChild(processInline(im[1]));
                ol.appendChild(li);
                i++;
            }
            container.appendChild(ol);
            continue;
        }

        // ── Regular paragraph ─────────────────────────────────────────────────
        const paraLines = [];
        while (i < lines.length) {
            const pl = lines[i].trimEnd();
            if (!pl.trim()) break;
            if (/^#{1,6}\s/.test(pl)) break;
            if (/^[-*_]{3,}$/.test(pl.trim())) break;
            if (/^[\-*+]\s+\S/.test(pl)) break;
            if (/^\d+\.\s+\S/.test(pl)) break;
            if (/^:(param|type|returns?|rtype|raises?|var|ivar|cvar)\b/.test(pl)) break;
            // Stop if next line is a setext-style underline
            if (paraLines.length > 0 && i + 1 < lines.length) {
                const nx = lines[i + 1].trimEnd();
                if (/^[=\-]{3,}$/.test(nx)) break;
            }
            paraLines.push(pl);
            i++;
        }

        if (paraLines.length > 0) {
            const p = document.createElement('p');
            p.appendChild(processInline(paraLines.join(' ')));
            container.appendChild(p);
        }
    }
}

/**
 * Render a Markdown string (with embedded RST markup) to an HTML element.
 *
 * Fenced code blocks are extracted first; the remaining text is passed to
 * renderBlocks() for block-level processing.
 *
 * @param {string} text - Raw markdown / RST text
 * @returns {HTMLElement}
 */
export function renderMarkdown(text) {
    const container = document.createElement('div');
    container.className = 'cm-hover-markdown';
    if (!text || !text.trim()) return container;

    // Split on fenced code blocks (``` … ```)
    const fenceRe = /^```(\w*)\n([\s\S]*?)^```/gm;
    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = fenceRe.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
        }
        segments.push({ type: 'code', lang: match[1], content: match[2] });
        lastIndex = fenceRe.lastIndex;
    }
    if (lastIndex < text.length) {
        segments.push({ type: 'text', content: text.slice(lastIndex) });
    }

    for (const seg of segments) {
        if (seg.type === 'code') {
            const pre = document.createElement('pre');
            const codeEl = document.createElement('code');
            if (seg.lang) codeEl.className = `language-${seg.lang}`;
            codeEl.textContent = seg.content.trimEnd();
            pre.appendChild(codeEl);
            container.appendChild(pre);
        } else {
            renderBlocks(seg.content, container);
        }
    }

    return container;
}

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
