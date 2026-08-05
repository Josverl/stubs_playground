import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorState } from '@codemirror/state';

import {
    createDiagnosticsSubscription,
    createLSPDiagnostics,
} from '../src/diagnostics.js';
import {
    getWorkspaceDiagnostics,
    notifyDocumentClose,
    notifyDocumentOpen,
} from '../src/index.js';
import { SimpleLSPClient } from '../src/simple-client.js';

const FILE_URI = 'file:///workspace/main.py';
const RENAMED_FILE_URI = 'file:///workspace/app.py';

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

test('diagnostics extensions include a merge-safe lint source and lifecycle plugin', () => {
    const client = new SimpleLSPClient();
    const view = { state: EditorState.create({ doc: '' }) };

    const extensions = createLSPDiagnostics(client, FILE_URI, view);

    assert.equal(extensions.length, 3);
    assert.equal(client.messageHandlers.length, 0);
});

test('merge-safe publications are labeled and do not dispatch replacement diagnostics', () => {
    const client = new SimpleLSPClient();
    const dispatches = [];
    const publications = [];
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
        null,
        (diagnostics) => publications.push(diagnostics),
    );

    client.handleNotification('textDocument/publishDiagnostics', {
        uri: FILE_URI,
        diagnostics: [{
            range: {
                start: { line: 0, character: 8 },
                end: { line: 0, character: 20 },
            },
            severity: 1,
            message: '"missing_name" is not defined',
        }],
    });

    assert.equal(dispatches.length, 0);
    assert.equal(publications.length, 1);
    assert.equal(publications[0][0].source, 'Pyright');
    subscription.destroy();
});

test('document close clears cached diagnostics before opening a renamed URI', () => {
    const sent = [];
    const client = new SimpleLSPClient();
    client.transport = {
        send(message) {
            sent.push(JSON.parse(message));
        },
    };
    const view = {
        state: EditorState.create({ doc: 'value = missing_name\n' }),
        dispatch() {},
    };
    const subscription = createDiagnosticsSubscription(client, FILE_URI, view);

    notifyDocumentOpen(client, FILE_URI, 'python', view.state.doc.toString(), 1);
    client.handleNotification('textDocument/publishDiagnostics', {
        uri: FILE_URI,
        diagnostics: [{
            range: {
                start: { line: 0, character: 8 },
                end: { line: 0, character: 20 },
            },
            severity: 1,
            message: '"missing_name" is not defined',
            source: 'Pyright',
        }],
    });
    assert.equal(getWorkspaceDiagnostics().length, 1);

    notifyDocumentClose(client, FILE_URI);
    assert.deepEqual(getWorkspaceDiagnostics(), []);

    notifyDocumentOpen(client, RENAMED_FILE_URI, 'python', 'value = 42\n', 1);
    assert.deepEqual(
        sent.map(({ method, params }) => ({ method, params })),
        [{
            method: 'textDocument/didOpen',
            params: {
                textDocument: {
                    uri: FILE_URI,
                    languageId: 'python',
                    version: 1,
                    text: 'value = missing_name\n',
                },
            },
        }, {
            method: 'textDocument/didClose',
            params: {
                textDocument: {
                    uri: FILE_URI,
                },
            },
        }, {
            method: 'textDocument/didOpen',
            params: {
                textDocument: {
                    uri: RENAMED_FILE_URI,
                    languageId: 'python',
                    version: 1,
                    text: 'value = 42\n',
                },
            },
        }],
    );

    subscription.destroy();
});
