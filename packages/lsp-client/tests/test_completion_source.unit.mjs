import test from 'node:test';
import assert from 'node:assert/strict';

import { createCompletionSource } from '../src/completion.js';

function makeContext({
    explicit = false,
    pos = 8,
    lineText = 't.sleep',
    word = { from: 2, to: 8, text: 't.sleep' },
}) {
    return {
        explicit,
        pos,
        matchBefore() {
            return word;
        },
        state: {
            doc: {
                lineAt() {
                    return { text: lineText, from: 0, number: 1 };
                },
            },
        },
    };
}

test('auto dotted trigger waits before requesting LSP', async () => {
    const calls = [];
    const lspClient = {
        async request(method, payload) {
            calls.push({ method, payload, at: Date.now() });
            return [{ label: 'sleep', kind: 3 }];
        },
    };

    const source = createCompletionSource(lspClient, 'file:///workspace/document.py', {
        autoTriggerDelayMs: 30,
    });

    const started = Date.now();
    const result = await source(makeContext({ explicit: false }));
    const elapsed = Date.now() - started;

    assert.equal(calls.length, 1);
    assert.ok(elapsed >= 25, `expected auto-trigger wait, got ${elapsed}ms`);
    assert.equal(result.options[0].label, 'sleep');
});

test('explicit completion does not wait for debounce delay', async () => {
    const calls = [];
    const lspClient = {
        async request() {
            calls.push(Date.now());
            return [{ label: 'sleep', kind: 3 }];
        },
    };

    const source = createCompletionSource(lspClient, 'file:///workspace/document.py', {
        autoTriggerDelayMs: 40,
    });

    const started = Date.now();
    await source(makeContext({ explicit: true }));
    const elapsed = Date.now() - started;

    assert.equal(calls.length, 1);
    assert.ok(elapsed < 35, `explicit request should skip delay, got ${elapsed}ms`);
});

test('stale async completion result is dropped when newer request exists', async () => {
    let resolveFirst;
    const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
    });

    let secondCall = false;
    const lspClient = {
        async request() {
            if (!secondCall) {
                secondCall = true;
                return firstPromise;
            }
            return [{ label: 'sleep', kind: 3 }];
        },
    };

    const source = createCompletionSource(lspClient, 'file:///workspace/document.py', {
        autoTriggerDelayMs: 0,
    });

    const firstRun = source(makeContext({ explicit: true, word: { from: 2, to: 3, text: 't' } }));
    const secondRun = source(makeContext({ explicit: true, word: { from: 2, to: 8, text: 't.sleep' } }));

    const second = await secondRun;
    resolveFirst([{ label: 'stale', kind: 3 }]);
    const first = await firstRun;

    assert.equal(second.options[0].label, 'sleep');
    assert.equal(first, null);
});
