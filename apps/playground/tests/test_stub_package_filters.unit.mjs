import assert from 'node:assert/strict';
import test from 'node:test';

import {
    availableRuntimeVersionOptions,
    availableStubFilterValues,
    detectedDefaultRuntimeVersion,
    filterStubPackages,
} from '../stub-package-filters.js';

const packages = [
    {
        id: 'micropython-rp2-rpi-pico-stubs',
        packageName: 'micropython-rp2-rpi-pico-stubs',
        kind: 'runtime',
        family: 'micropython',
        runtimeVersions: ['1.27.0', '1.28.0'],
        port: 'rp2',
        board: 'RPI_PICO',
    },
    {
        id: 'micropython-rp2-stubs',
        packageName: 'micropython-rp2-stubs',
        kind: 'runtime',
        family: 'micropython',
        runtimeVersions: ['1.26.1', '1.27.0', '1.28.0'],
        port: 'rp2',
        board: 'GENERIC',
    },
    {
        id: 'circuitpython-stubs',
        packageName: 'circuitpython-stubs',
        kind: 'runtime',
        family: 'circuitpython',
        runtimeVersions: [],
        port: '',
        board: '',
    },
];

test('MicroPython version choices use the newest three stable catalog releases', () => {
    const catalog = {
        availableRuntimeVersions: ['1.29.0-preview', '1.27.0', '1.28.0', '1.26.1', '1.25.0'],
        defaultRuntimeVersion: '1.28.0',
    };

    assert.deepEqual(availableRuntimeVersionOptions(catalog), ['1.28.0', '1.27.0', '1.26.1']);
    assert.equal(detectedDefaultRuntimeVersion(catalog), '1.28.0');
});

test('relevant packages filter by family, major/minor version, port, and board', () => {
    const result = filterStubPackages(packages, {
        family: 'micropython',
        version: '1.28.9',
        port: 'rp2',
        board: 'RPI_PICO',
    });

    assert.deepEqual(result.map(entry => entry.packageName), [
        'micropython-rp2-rpi-pico-stubs',
    ]);
});

test('version filtering ignores patch differences in published runtime metadata', () => {
    const result = filterStubPackages(packages, {
        family: 'micropython',
        version: '1.26.0',
        port: 'rp2',
        board: 'GENERIC',
    });

    assert.deepEqual(result.map(entry => entry.packageName), ['micropython-rp2-stubs']);
});

test('available board values are narrowed and put GENERIC first', () => {
    const values = availableStubFilterValues(packages, {
        family: 'micropython',
        version: '1.27.0',
        port: 'rp2',
        board: '',
    }, 'board');

    assert.deepEqual(values, ['GENERIC', 'RPI_PICO']);
});

test('CircuitPython placeholder is selected without MicroPython version semantics', () => {
    const result = filterStubPackages(packages, {
        family: 'circuitpython',
        version: '',
    });

    assert.deepEqual(result.map(entry => entry.packageName), ['circuitpython-stubs']);
});