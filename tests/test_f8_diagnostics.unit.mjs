import test from 'node:test';
import assert from 'node:assert/strict';

import {
    convertLSPDiagnostic,
    lspSeverityToString,
    positionToOffset,
    runNextDiagnostic,
    runPreviousDiagnostic,
} from '../src/lsp/diagnostics-core.mjs';

function makeDoc(lines) {
    const offsets = [];
    let cursor = 0;
    for (const line of lines) {
        offsets.push({ from: cursor, to: cursor + line.length });
        cursor += line.length + 1; // account for newline separator
    }

    return {
        lines: lines.length,
        length: cursor > 0 ? cursor - 1 : 0,
        line(n) {
            if (n < 1 || n > offsets.length) {
                throw new RangeError(`line ${n} is out of range`);
            }
            return offsets[n - 1];
        },
    };
}

test('F8 behavior opens lint panel, navigates next, and restores focus', () => {
    const calls = [];
    const view = {
        focus() {
            calls.push('focus');
        },
    };

    const openLintPanel = (arg) => {
        assert.equal(arg, view);
        calls.push('open');
    };

    const nextDiagnostic = (arg) => {
        assert.equal(arg, view);
        calls.push('next');
        return true;
    };

    const result = runNextDiagnostic(view, openLintPanel, nextDiagnostic);

    assert.equal(result, true);
    assert.deepEqual(calls, ['open', 'next', 'focus']);
});

test('F8 behavior remains safe when no next diagnostic exists', () => {
    const calls = [];
    const view = {
        focus() {
            calls.push('focus');
        },
    };

    const result = runNextDiagnostic(
        view,
        () => calls.push('open'),
        () => {
            calls.push('next');
            return false;
        }
    );

    assert.equal(result, false);
    assert.deepEqual(calls, ['open', 'next', 'focus']);
});

test('Shift-F8 behavior opens lint panel, navigates previous, and restores focus', () => {
    const calls = [];
    const view = {
        focus() {
            calls.push('focus');
        },
    };

    const result = runPreviousDiagnostic(
        view,
        () => calls.push('open'),
        () => {
            calls.push('previous');
            return true;
        }
    );

    assert.equal(result, true);
    assert.deepEqual(calls, ['open', 'previous', 'focus']);
});

test('convertLSPDiagnostic appends code to source when present', () => {
    const doc = makeDoc(['abcde', 'second']);
    const converted = convertLSPDiagnostic(
        {
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
            },
            severity: 1,
            message: 'Test message with code',
            code: 'reportOptionalMemberAccess',
            source: 'Pyright',
        },
        doc
    );

    assert.equal(converted.from, 0);
    assert.equal(converted.to, 5);
    assert.equal(converted.severity, 'error');
    assert.equal(converted.source, 'Pyright: reportOptionalMemberAccess');
});

test('convertLSPDiagnostic keeps source unchanged when code is missing', () => {
    const doc = makeDoc(['abcde']);
    const converted = convertLSPDiagnostic(
        {
            range: {
                start: { line: 0, character: 1 },
                end: { line: 0, character: 3 },
            },
            severity: 2,
            message: 'warning without code',
            source: 'Pyright',
        },
        doc
    );

    assert.equal(converted.severity, 'warning');
    assert.equal(converted.source, 'Pyright');
});

test('positionToOffset clamps stale line/character to valid bounds', () => {
    const doc = makeDoc(['abc', 'xy']);

    assert.equal(positionToOffset(doc, { line: 0, character: 999 }), 3);
    assert.equal(positionToOffset(doc, { line: 999, character: 0 }), doc.length);
});

test('lspSeverityToString maps LSP severities to CodeMirror severities', () => {
    assert.equal(lspSeverityToString(1), 'error');
    assert.equal(lspSeverityToString(2), 'warning');
    assert.equal(lspSeverityToString(3), 'info');
    assert.equal(lspSeverityToString(4), 'info');
    assert.equal(lspSeverityToString(999), 'error');
});
