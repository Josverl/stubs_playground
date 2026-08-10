import test from 'node:test';
import assert from 'node:assert/strict';

import { EditorState } from '@codemirror/state';

import { createLSPPlugin } from '../src/client.js';

test('plugin can request dotted completions without a synchronization delay', async () => {
    const requests = [];
    const client = {
        notify() {},
        onNotification() {
            return () => {};
        },
        async request(method, params) {
            requests.push({ method, params });
            return [{ label: 'sleep', kind: 3 }];
        },
    };
    const view = { state: { doc: null } };
    const extensions = createLSPPlugin(client, view, {
        initialContent: 't.',
        completionDelayMs: 0,
    });
    const state = EditorState.create({ doc: 't.', extensions });
    view.state.doc = state.doc;
    const [completionSource] = state.languageDataAt('autocomplete', 2);
    const originalSetTimeout = globalThis.setTimeout;

    globalThis.setTimeout = () => {
        throw new Error('zero-delay completion scheduled a timer');
    };
    try {
        const result = await completionSource({
            explicit: false,
            pos: 2,
            state,
            matchBefore: () => ({ from: 0, to: 2, text: 't.' }),
        });

        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, 'textDocument/completion');
        assert.equal(requests[0].params.context.triggerCharacter, '.');
        assert.equal(result.options[0].label, 'sleep');
    } finally {
        globalThis.setTimeout = originalSetTimeout;
    }
});