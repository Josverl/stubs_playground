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
export const PYRIGHT_SIG_RE = /^\((?:module|class|function|method|variable|parameter|property|constant|overload|type alias|type)\)\s+|^(?:class|def)\s+\w/;

const RST_FIELD_RE = /^:(param|type|returns?|rtype|raises?|var|ivar|cvar)\b/;
const RST_ADMONITION_RE = /^Admonition:\s*(.+?)(?:\s+:class:\s+([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*))?\s*$/;
const RST_ADMONITION_CLASS_LINE_RE = /^:class:\s+([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*)\s*$/;

function parseAdmonitionHeader(line) {
    const match = line.match(RST_ADMONITION_RE);
    if (!match) return null;

    return {
        title: match[1].trim().replace(/\s+:class:\s+[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*\s*$/, ''),
        classes: match[2] ? match[2].split(/\s+/).filter(Boolean) : [],
    };
}

function parseAdmonitionClassLine(line) {
    const match = line.trim().match(RST_ADMONITION_CLASS_LINE_RE);
    if (!match) return null;
    return match[1].split(/\s+/).filter(Boolean);
}

function isBlockBoundaryStart(line) {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) return false;

    return (
        /^#{1,6}\s+/.test(trimmed) ||
        /^[-*_]{3,}$/.test(trimmed.trim()) ||
        /^[\-*+]\s+\S/.test(trimmed) ||
        /^\d+\.\s+\S/.test(trimmed) ||
        RST_FIELD_RE.test(trimmed) ||
        !!parseAdmonitionHeader(trimmed)
    );
}

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
export function processInline(text) {
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
export function renderBlocks(text, container) {
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
        if (RST_FIELD_RE.test(trimmed)) {
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

        // ── Flattened RST admonition: Admonition:Title :class: attention ─────
        const admonitionMeta = parseAdmonitionHeader(trimmed);
        if (admonitionMeta) {
            const admonition = document.createElement('section');
            admonition.className = 'cm-hover-admonition';

            const title = document.createElement('div');
            title.className = 'cm-hover-admonition-title';
            title.appendChild(processInline(admonitionMeta.title));
            admonition.appendChild(title);

            for (const className of admonitionMeta.classes) {
                admonition.classList.add(`cm-hover-admonition-${className.toLowerCase()}`);
            }

            i++;
            while (i < lines.length && !lines[i].trim()) i++;

            if (i < lines.length) {
                const classLineClasses = parseAdmonitionClassLine(lines[i]);
                if (classLineClasses) {
                    for (const className of classLineClasses) {
                        admonition.classList.add(`cm-hover-admonition-${className.toLowerCase()}`);
                    }
                    i++;
                    while (i < lines.length && !lines[i].trim()) i++;
                }
            }

            const bodyLines = [];
            while (i < lines.length) {
                const current = lines[i];
                const currentClassLineClasses = parseAdmonitionClassLine(current);
                if (currentClassLineClasses) {
                    for (const className of currentClassLineClasses) {
                        admonition.classList.add(`cm-hover-admonition-${className.toLowerCase()}`);
                    }
                    i++;
                    continue;
                }

                if (!current.trim()) {
                    let next = i + 1;
                    while (next < lines.length && !lines[next].trim()) next++;
                    if (next >= lines.length) {
                        i = next;
                        break;
                    }
                    if (isBlockBoundaryStart(lines[next])) break;
                    bodyLines.push('');
                    i++;
                    continue;
                }

                bodyLines.push(current);
                i++;
            }

            if (bodyLines.length > 0) {
                const body = document.createElement('div');
                body.className = 'cm-hover-admonition-body';
                renderBlocks(bodyLines.join('\n'), body);
                admonition.appendChild(body);
            }

            container.appendChild(admonition);
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
            if (RST_FIELD_RE.test(pl)) break;
            if (parseAdmonitionHeader(pl)) break;
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
 * @returns {HTMLElement} A div element containing rendered HTML
 */
export function renderMarkdown(text) {
    const container = document.createElement('div');
    container.className = 'cm-hover-markdown';
    if (!text || !text.trim()) return container;

    // If the first non-empty line looks like a Pyright type/signature declaration,
    // render it as a monospace signature block and continue with the rest.
    // Pyright emits multi-line signatures with indented params when there are
    // many arguments, e.g.:
    //   class Pin(
    //       id: Any,
    //       /,
    //       mode: int = -1,
    //   )
    // Consume lines until parentheses/brackets are balanced (depth → 0).
    let body = text;
    const lines = text.split('\n');
    const firstLine = lines[0].trim();
    if (firstLine && PYRIGHT_SIG_RE.test(firstLine)) {
        let depth = 0;
        let sigEndLine = 0;

        for (let i = 0; i < Math.min(lines.length, 40); i++) {
            for (const ch of lines[i]) {
                if (ch === '(' || ch === '[') depth++;
                else if (ch === ')' || ch === ']') depth--;
            }
            sigEndLine = i + 1;
            // Stop once parens balance out (or first line had none at all)
            if (depth <= 0) break;
        }

        const sigText = lines.slice(0, sigEndLine).join('\n');
        const sig = document.createElement('div');
        sig.className = 'cm-hover-signature';
        const code = document.createElement('code');
        code.textContent = sigText;
        sig.appendChild(code);
        container.appendChild(sig);

        // Skip the blank separator line(s) between signature and docstring body
        let bodyStart = sigEndLine;
        while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;
        body = lines.slice(bodyStart).join('\n');
    }

    // Split on fenced code blocks (``` … ```)
    const fenceRe = /^```(\w*)\n([\s\S]*?)^```/gm;
    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = fenceRe.exec(body)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: body.slice(lastIndex, match.index) });
        }
        segments.push({ type: 'code', lang: match[1], content: match[2] });
        lastIndex = fenceRe.lastIndex;
    }
    if (lastIndex < body.length) {
        segments.push({ type: 'text', content: body.slice(lastIndex) });
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
