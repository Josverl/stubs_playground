import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizePackageName,
    parsePackageSpecifier,
    selectStubWheelRelease,
} from '../src/stubs/pypi-client.js';

import {
    upsertExtraStubEntry,
    buildAbsoluteExtraPaths,
    buildWorkerExtraStubPayload,
} from '../src/stubs/extra-stubs-registry.js';

test('normalizePackageName applies PEP-503 style normalization', () => {
    assert.equal(normalizePackageName('Types_Requests.Stubs'), 'types-requests-stubs');
});

test('selectStubWheelRelease chooses highest matching universal wheel', () => {
    const selected = selectStubWheelRelease({
        releases: {
            '1.0.0': [
                {
                    packagetype: 'bdist_wheel',
                    filename: 'types_demo_stubs-1.0.0-py3-none-any.whl',
                    url: 'https://files.example/1.0.0.whl',
                    upload_time_iso_8601: '2024-01-01T00:00:00.000Z',
                },
            ],
            '2.0.0': [
                {
                    packagetype: 'bdist_wheel',
                    filename: 'types_demo_stubs-2.0.0-cp311-cp311-manylinux.whl',
                    url: 'https://files.example/2.0.0-linux.whl',
                    upload_time_iso_8601: '2025-01-01T00:00:00.000Z',
                },
                {
                    packagetype: 'bdist_wheel',
                    filename: 'types_demo_stubs-2.0.0-py3-none-any.whl',
                    url: 'https://files.example/2.0.0.whl',
                    upload_time_iso_8601: '2025-01-01T00:00:00.000Z',
                },
            ],
        },
    }, '>=1.0.0');

    assert.equal(selected.version, '2.0.0');
    assert.equal(selected.wheel.url, 'https://files.example/2.0.0.whl');
});

test('selectStubWheelRelease supports wildcard equality specifier', () => {
    const selected = selectStubWheelRelease({
        releases: {
            '1.20.0': [
                {
                    packagetype: 'bdist_wheel',
                    filename: 'types_demo_stubs-1.20.0-py3-none-any.whl',
                    url: 'https://files.example/1.20.0.whl',
                    upload_time_iso_8601: '2025-01-01T00:00:00.000Z',
                },
            ],
            '1.20.0.post3': [
                {
                    packagetype: 'bdist_wheel',
                    filename: 'types_demo_stubs-1.20.0.post3-py3-none-any.whl',
                    url: 'https://files.example/1.20.0.post3.whl',
                    upload_time_iso_8601: '2025-01-10T00:00:00.000Z',
                },
            ],
            '1.20.1': [
                {
                    packagetype: 'bdist_wheel',
                    filename: 'types_demo_stubs-1.20.1-py3-none-any.whl',
                    url: 'https://files.example/1.20.1.whl',
                    upload_time_iso_8601: '2025-01-20T00:00:00.000Z',
                },
            ],
        },
    }, '==1.20.0.*');

    assert.equal(selected.version, '1.20.0.post3');
    assert.equal(selected.wheel.url, 'https://files.example/1.20.0.post3.whl');
});

test('selectStubWheelRelease supports limited 1->0 patch fallback for post releases', () => {
    const selected = selectStubWheelRelease({
        releases: {
            '1.23.0.post1': [
                {
                    packagetype: 'bdist_wheel',
                    filename: 'types_demo_stubs-1.23.0.post1-py3-none-any.whl',
                    url: 'https://files.example/1.23.0.post1.whl',
                    upload_time_iso_8601: '2025-02-01T00:00:00.000Z',
                },
            ],
        },
    }, '==1.23.1.*');

    assert.equal(selected.version, '1.23.0.post1');
    assert.equal(selected.wheel.url, 'https://files.example/1.23.0.post1.whl');
});

test('parsePackageSpecifier splits package and optional constraints', () => {
    assert.deepEqual(parsePackageSpecifier('micropython-esp8266-stubs'), {
        packageName: 'micropython-esp8266-stubs',
        versionSpecifier: '',
    });

    assert.deepEqual(parsePackageSpecifier('micropython-esp8266-stubs==1.20.0.*'), {
        packageName: 'micropython-esp8266-stubs',
        versionSpecifier: '==1.20.0.*',
    });

    assert.deepEqual(parsePackageSpecifier('micropython-esp8266-stubs >=1.20,<1.21'), {
        packageName: 'micropython-esp8266-stubs',
        versionSpecifier: '>=1.20,<1.21',
    });
});

test('upsertExtraStubEntry replaces existing package while keeping additive others', () => {
    const first = upsertExtraStubEntry([], {
        packageName: 'types-requests',
        version: '1.0.0',
        files: { 'requests/__init__.pyi': '...' },
    });

    const second = upsertExtraStubEntry(first, {
        packageName: 'types-urllib3',
        version: '2.0.0',
        files: { 'urllib3/__init__.pyi': '...' },
    });

    const replaced = upsertExtraStubEntry(second, {
        packageName: 'types-requests',
        version: '1.1.0',
        files: { 'requests/__init__.pyi': '# newer' },
    });

    assert.equal(replaced.length, 2);
    const requests = replaced.find((entry) => entry.packageName === 'types-requests');
    assert.equal(requests.version, '1.1.0');

    const paths = buildAbsoluteExtraPaths(replaced);
    assert.deepEqual(paths, ['/extra/types-requests', '/extra/types-urllib3']);

    const payload = buildWorkerExtraStubPayload(replaced);
    assert.equal(payload.length, 2);
    assert.equal(payload[0].packageName, 'types-requests');
});
