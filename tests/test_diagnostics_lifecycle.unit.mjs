import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorState } from '@codemirror/state';

import {
    createDiagnosticsSubscription,
    createLSPDiagnostics,
} from '../packages/lsp-client/src/diagnostics.js';
import { SimpleLSPClient } from '../packages/lsp-client/src/simple-client.js';

const FILE_URI = 'file:///workspace/main.py';

test('diagnostics subscription is disposed with its view plugin', () => {
    const client = new SimpleLSPClient();
    const dispatches = [];
    const snapshots = [];
    const view = {
        state: EditorState.create({ doc: 'value = missing_name\n' }),
        dispatch(spec) {
            dispatches.push(spec);
        },
    };

    const subscription = createDiagnosticsSubscription(
        client,
        FILE_URI,
        view,
        (diagnostics) => snapshots.push(diagnostics),
    );

    assert.equal(client.messageHandlers.length, 1);

    client.handleNotification('textDocument/publishDiagnostics', {
        uri: FILE_URI,
        diagnostics: [],
    });
    assert.equal(dispatches.length, 1);
    assert.deepEqual(snapshots, [[]]);

    subscription.destroy();
    subscription.destroy();
    assert.equal(client.messageHandlers.length, 0);

    client.handleNotification('textDocument/publishDiagnostics', {
        uri: FILE_URI,
        diagnostics: [],
    });
    assert.equal(dispatches.length, 1);
    assert.deepEqual(snapshots, [[]]);
});

test('diagnostics extensions include a lifecycle-owned view plugin', () => {
    const client = new SimpleLSPClient();
    const view = { state: EditorState.create({ doc: '' }) };

    const extensions = createLSPDiagnostics(client, FILE_URI, view);

    assert.equal(extensions.length, 2);
    assert.equal(client.messageHandlers.length, 0);
});
