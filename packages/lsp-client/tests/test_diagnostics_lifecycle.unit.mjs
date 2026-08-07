import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorState } from '@codemirror/state';

import { createDebouncedPublisher } from '../src/diagnostics-core.mjs';
import {
    createDeferredDiagnosticsPublisher,
    createDiagnosticsSubscription,
    createLSPDiagnostics,
    createWorkspaceDiagnosticsSubscription,
} from '../src/diagnostics.js';
import {
    getWorkspaceDiagnostics,
    notifyDocumentClose,
    notifyDocumentOpen,
} from '../src/index.js';
import { SimpleLSPClient } from '../src/simple-client.js';

const FILE_URI = 'file:///workspace/main.py';
const RENAMED_FILE_URI = 'file:///workspace/app.py';
const UNOPENED_FILE_URI = 'file:///workspace/lib/unopened.py';

test('diagnostic debounce publishes only the latest result after idle time', () => {
    const scheduled = [];
    const published = [];
    const publisher = createDebouncedPublisher(
        diagnostics => published.push(diagnostics),
        750,
        (callback, delay) => {
            const timer = { callback, delay, cancelled: false };
            scheduled.push(timer);
            return timer;
        },
        timer => {
            timer.cancelled = true;
        },
    );

    publisher.publish(['transient']);
    publisher.publish(['settled']);

    assert.equal(scheduled[0].cancelled, true);
    assert.equal(scheduled[1].delay, 750);
    assert.deepEqual(published, []);

    scheduled[1].callback();
    assert.deepEqual(published, [['settled']]);
});

test('diagnostic debounce cancels pending publication during editor teardown', () => {
    const scheduled = [];
    const published = [];
    const publisher = createDebouncedPublisher(
        diagnostics => published.push(diagnostics),
        750,
        callback => {
            const timer = { callback, cancelled: false };
            scheduled.push(timer);
            return timer;
        },
        timer => {
            timer.cancelled = true;
        },
    );

    publisher.publish(['stale']);
    publisher.cancel();

    assert.equal(scheduled[0].cancelled, true);
    assert.deepEqual(published, []);
});

test('deferred diagnostics map positions against the document at publication time', () => {
    const scheduled = [];
    const published = [];
    const view = {
        state: EditorState.create({ doc: 'value = 1\nprint(missing_name)\n' }),
    };
    const publisher = createDeferredDiagnosticsPublisher(
        view,
        diagnostics => published.push(diagnostics),
        750,
        callback => {
            scheduled.push(callback);
            return callback;
        },
        () => {},
    );
    publisher.publish([{
        range: {
            start: { line: 1, character: 6 },
            end: { line: 1, character: 18 },
        },
        severity: 2,
        message: '"missing_name" is not defined',
    }]);

    view.state = EditorState.create({ doc: 'value = 1\n' });
    scheduled[0]();

    assert.equal(published[0][0].from, view.state.doc.length);
    assert.equal(published[0][0].to, view.state.doc.length);
});

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

test('workspace diagnostics subscription includes unopened files and clears stale reports', () => {
    const client = new SimpleLSPClient();
    const snapshots = [];
    const subscription = createWorkspaceDiagnosticsSubscription(
        client,
        diagnostics => snapshots.push(diagnostics),
    );

    client.handleNotification('textDocument/publishDiagnostics', {
        uri: UNOPENED_FILE_URI,
        diagnostics: [{
            range: {
                start: { line: 2, character: 4 },
                end: { line: 2, character: 11 },
            },
            severity: 1,
            message: '"missing" is not defined',
            source: 'Pyright',
            code: 'reportUndefinedVariable',
        }],
    });
    client.handleNotification('textDocument/publishDiagnostics', {
        uri: FILE_URI,
        diagnostics: [{
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 6 },
            },
            severity: 2,
            message: 'Import is not accessed',
        }],
    });

    assert.deepEqual(snapshots.at(-1).map(({ fileName, severity, source }) => ({
        fileName,
        severity,
        source,
    })), [{
        fileName: 'lib/unopened.py',
        severity: 'error',
        source: 'Pyright: reportUndefinedVariable',
    }, {
        fileName: 'main.py',
        severity: 'warning',
        source: 'Pyright',
    }]);

    client.handleNotification('textDocument/publishDiagnostics', {
        uri: UNOPENED_FILE_URI,
        diagnostics: [],
    });
    assert.deepEqual(snapshots.at(-1).map(diagnostic => diagnostic.fileName), ['main.py']);

    subscription.destroy();
    client.handleNotification('textDocument/publishDiagnostics', {
        uri: FILE_URI,
        diagnostics: [],
    });
    assert.equal(snapshots.length, 3);
});

test('diagnostics extensions include a merge-safe lint source and lifecycle plugin', () => {
    const client = new SimpleLSPClient();
    const view = { state: EditorState.create({ doc: '' }) };

    const extensions = createLSPDiagnostics(client, FILE_URI, view);

    assert.equal(extensions.length, 3);
    assert.equal(client.messageHandlers.length, 0);
});

test('document edits clear published Pyright diagnostics before linting again', () => {
    const client = new SimpleLSPClient();
    const dispatches = [];
    const pluginView = {
        state: EditorState.create({ doc: 'print(missing_name)\n' }),
        plugin: () => null,
        dispatch(spec) {
            dispatches.push(spec);
        },
    };
    const extensions = createLSPDiagnostics(client, FILE_URI, pluginView);
    const diagnosticSource = extensions[1][0].value.source;
    const plugin = extensions[2].create(pluginView);

    client.handleNotification('textDocument/publishDiagnostics', {
        uri: FILE_URI,
        diagnostics: [{
            range: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 18 },
            },
            severity: 2,
            message: '"missing_name" is not defined',
        }],
    });
    assert.equal(diagnosticSource().length, 1);
    const needsRefresh = extensions[1][0].value.config.needsRefresh;
    assert.equal(needsRefresh({ transactions: [{ effects: [dispatches[0].effects] }] }), true);

    plugin.update({ docChanged: true });
    assert.deepEqual(diagnosticSource(), []);
    plugin.destroy();
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
    const { line, character, endLine, endCharacter } = getWorkspaceDiagnostics()[0];
    assert.deepEqual(
        { line, character, endLine, endCharacter },
        { line: 1, character: 9, endLine: 1, endCharacter: 21 },
    );

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
