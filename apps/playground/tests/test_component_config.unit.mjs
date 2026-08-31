import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { componentConfig } from '../component-config.generated.js';

const root = new URL('../../../', import.meta.url);

test('generated npm config matches playground dependencies', async () => {
    const result = spawnSync(
        process.execPath,
        ['scripts/generate-component-config.mjs', '--check'],
        { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const app = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
    assert.equal(
        componentConfig.lspClient.version,
        app.dependencies['@mp-codemirror/lsp-client'],
    );
    assert.equal(
        componentConfig.pyrightWorker.version,
        app.dependencies['@mp-codemirror/pyright-worker'],
    );
});

test('runtime source selector contains no component release versions', async () => {
    const source = await readFile(
        new URL('../component-source.js', import.meta.url),
        'utf8',
    );
    assert.doesNotMatch(source, /(?:lsp-client|pyright-worker)-v\d/);
    assert.match(source, /component-config\.generated\.js/);
    assert.match(source, /runtime-manifest\.json/);
    assert.match(source, /runtimeAllowedOrigins/);
});
