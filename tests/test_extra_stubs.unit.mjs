import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizePackageName,
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
