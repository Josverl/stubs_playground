import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveShareSettings } from '../share.js';

test('resolveShareSettings returns expected values from provider callbacks', () => {
    const settings = resolveShareSettings(
        () => 'esp32',
        () => 'strict',
        () => 'cpython',
        () => '3.14'
    );

    assert.deepEqual(settings, {
        board: 'esp32',
        typeCheckMode: 'strict',
        stdlib: 'cpython',
        pythonVersion: '3.14',
    });
});

test('resolveShareSettings handles missing providers', () => {
    const settings = resolveShareSettings(() => 'rp2', () => 'standard');

    assert.deepEqual(settings, {
        board: 'rp2',
        typeCheckMode: 'standard',
        stdlib: undefined,
        pythonVersion: undefined,
    });
});
