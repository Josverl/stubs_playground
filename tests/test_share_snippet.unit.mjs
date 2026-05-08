import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MARKDOWN_CODE_SNIPPET_MAX_LINES,
    getCenteredCodeSnippet,
} from '../src/share-ui.js';

function makeNumberedLines(count) {
    return Array.from({ length: count }, (_, i) => `line ${String(i + 1).padStart(2, '0')}`).join('\n');
}

test('snippet size is controlled by a single constant', () => {
    assert.equal(MARKDOWN_CODE_SNIPPET_MAX_LINES, 16);
});

test('centered snippet returns max 16 lines around cursor', () => {
    const text = makeNumberedLines(40);
    const snippet = getCenteredCodeSnippet(text, 20);
    const lines = snippet.split('\n');

    assert.equal(lines.length, 16);
    assert.equal(lines[0], 'line 12');
    assert.equal(lines[15], 'line 27');
    assert.ok(lines.includes('line 20'));
    assert.ok(!lines.includes('line 11'));
    assert.ok(!lines.includes('line 28'));
});

test('snippet clamps at start of document', () => {
    const text = makeNumberedLines(40);
    const snippet = getCenteredCodeSnippet(text, 1);
    const lines = snippet.split('\n');

    assert.equal(lines.length, 16);
    assert.equal(lines[0], 'line 01');
    assert.equal(lines[15], 'line 16');
});

test('snippet clamps at end of document', () => {
    const text = makeNumberedLines(40);
    const snippet = getCenteredCodeSnippet(text, 40);
    const lines = snippet.split('\n');

    assert.equal(lines.length, 16);
    assert.equal(lines[0], 'line 25');
    assert.equal(lines[15], 'line 40');
});

test('short documents are returned unchanged', () => {
    const text = makeNumberedLines(5);
    const snippet = getCenteredCodeSnippet(text, 3);
    assert.equal(snippet, text);
});
