/**
 * Unit tests for buildIssueUrl URI length handling
 *
 * Tests verify that when a GitHub issue URL would exceed 7200 bytes,
 * the code sample is automatically omitted and the URL is regenerated.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIssueUrl } from '../src/share-core.js';

const LONG_PLAYGROUND_URL =
    'https://very-long-playground-url-that-contributes-significantly-to-uri-length.example.com/' +
    'playground?board=esp32&stdlib=micropython&version=3.10&extra_param=with_more_data';

const LARGE_CODE = '# This is a long line that pushes the URL over the limit\n'.repeat(300);

test('small code sample is included when URL is under 7200 bytes', () => {
    const url = buildIssueUrl(
        'micropython-esp32-stubs',
        '1.28.0',
        'standard',
        'https://example.com/playground',
        [],
        [],
        "print('hello')"
    );

    assert.ok(url.length < 7200, `URL length ${url.length} should be < 7200`);
    assert.ok(url.includes('print'), 'code sample text should appear in URL');
    assert.ok(url.includes('%60%60%60python'), 'code block markers should appear in URL');
});

test('large code sample is omitted when URL would exceed 7200 bytes', () => {
    const url = buildIssueUrl(
        'micropython-esp32-stubs',
        '1.28.0.post3',
        'standard',
        LONG_PLAYGROUND_URL,
        [],
        [],
        LARGE_CODE
    );

    assert.ok(url.length < 7200, `URL length ${url.length} should be < 7200 after regeneration`);
    assert.ok(!url.includes('%60%60%60python'), 'code block should be removed');
    assert.ok(url.includes(encodeURIComponent(LONG_PLAYGROUND_URL)), 'playground link should be preserved');
});

test('diagnostics are preserved when code sample is removed', () => {
    const diagnostics = [
        { fileName: 'main.py', line: 10, character: 5, severity: 'error', message: 'Name "foo" is not defined' },
    ];

    const url = buildIssueUrl(
        'micropython-esp32-stubs',
        '1.28.0.post3',
        'standard',
        LONG_PLAYGROUND_URL,
        [],
        diagnostics,
        LARGE_CODE
    );

    assert.ok(url.length < 7200, `URL length ${url.length} should be < 7200`);
    assert.ok(!url.includes('%60%60%60python'), 'code block should be removed');
    assert.ok(url.includes('Diagnostics'), 'diagnostics section should be preserved');
    assert.ok(url.includes('foo'), 'diagnostic message should be preserved');
});

test('empty code sample does not trigger code-removal logic', () => {
    const url = buildIssueUrl(
        'micropython-esp32-stubs',
        '1.28.0.post3',
        'standard',
        LONG_PLAYGROUND_URL,
        [],
        [],
        ''
    );

    assert.ok(typeof url === 'string' && url.length > 0, 'URL should be returned');
    assert.ok(url.includes(encodeURIComponent(LONG_PLAYGROUND_URL)), 'playground link should be present');
});
