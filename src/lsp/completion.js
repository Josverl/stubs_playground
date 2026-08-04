/**
 * LSP Completion Integration for CodeMirror
 * 
 * This module integrates LSP textDocument/completion requests with CodeMirror's
 * autocomplete system, providing intelligent code completion from Pyright.
 */

import {
    computeCompletionFrom,
    convertCompletionItem,
    dedupeAndSortCompletionOptions,
} from './completion-core.mjs';

const AUTO_TRIGGER_WAIT_MS = 320;

function delay(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

/**
 * Create LSP completion source for CodeMirror
 * 
 * @param {import('./simple-client.js').SimpleLSPClient} lspClient - Connected LSP client.
 * @param {string} documentUri - The document URI (e.g., 'file:///workspace/document.py')
 * @param {Object} [options]
 * @param {number} [options.autoTriggerDelayMs=320] - Delay auto-triggered dotted completions to allow didChange debounce to flush
 * @returns {(context: import('@codemirror/autocomplete').CompletionContext) =>
 *   Promise<import('@codemirror/autocomplete').CompletionResult|null>}
 *   CodeMirror completion source. LSP request failures are logged and return `null`.
 */
export function createCompletionSource(lspClient, documentUri, options = {}) {
    const autoTriggerDelayMs = options.autoTriggerDelayMs ?? AUTO_TRIGGER_WAIT_MS;
    let latestRequestId = 0;

    return async (context) => {
        const requestId = ++latestRequestId;
        console.log('LSP completion source called, explicit:', context.explicit);

        // Try to match dotted attribute access (e.g., "sys.") or just words
        let word = context.matchBefore(/[\w\.]+/);

        // Only complete when explicitly requested or when we have something to complete
        if (!word || (word.from === word.to && !context.explicit)) {
            console.log('LSP completion: Rejected - no match or not explicit');
            return null;
        }

        // Get cursor position
        const pos = context.pos;
        const line = context.state.doc.lineAt(pos);
        const lineText = line.text;
        const character = pos - line.from;
        const lineNumber = context.state.doc.lineAt(pos).number - 1; // 0-based

        console.log(`LSP completion at line ${lineNumber + 1}, char ${character}, word: "${word.text}"`);

        const shouldWaitForDottedAutoTrigger = !context.explicit
            && autoTriggerDelayMs > 0
            && (lineText[character - 1] === '.' || word.text.includes('.'));

        if (shouldWaitForDottedAutoTrigger) {
            await delay(autoTriggerDelayMs);
            if (requestId !== latestRequestId) {
                return null;
            }
        }

        // Determine the starting position for completion
        // For dotted access like "sys.arg", start from after the last dot
        // so CodeMirror filters completions against "arg" not "sys.arg"
        const from = computeCompletionFrom(word);

        try {
            console.log('Sending textDocument/completion request to LSP...');

            // Send textDocument/completion request to LSP
            const result = await lspClient.request('textDocument/completion', {
                textDocument: {
                    uri: documentUri
                },
                position: {
                    line: lineNumber,
                    character: character
                },
                context: {
                    triggerKind: context.explicit ? 1 : 2, // 1=Invoked, 2=TriggerCharacter
                    triggerCharacter: lineText[character - 1] === '.' ? '.' : undefined
                }
            });

            if (requestId !== latestRequestId) {
                return null;
            }

            // Handle both CompletionList and CompletionItem[] responses
            const items = result?.items || result || [];

            if (!items || items.length === 0) {
                return null;
            }

            // Convert, dedupe, and rank LSP completion options before returning.
            const options = dedupeAndSortCompletionOptions(items.map(convertCompletionItem));

            return {
                from,
                options,
                validFor: /^[\w\.]*$/
            };
        } catch (error) {
            console.error('LSP completion error:', error);
            return null;
        }
    };
}
