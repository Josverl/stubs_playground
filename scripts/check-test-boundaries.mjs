import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const testExtensions = new Set(['.html', '.js', '.mjs', '.py']);

async function testFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return testFiles(path);
        return testExtensions.has(extname(entry.name)) ? [path] : [];
    }));
    return nested.flat();
}

const componentTestRoots = [
    resolve(root, 'packages/lsp-client/tests'),
    resolve(root, 'packages/pyright-worker/tests'),
];

const componentFiles = (
    await Promise.all(componentTestRoots.map((directory) => testFiles(directory)))
).flat();
componentFiles.push(resolve(root, 'tests/fixtures.py'));

for (const file of componentFiles) {
    const source = await readFile(file, 'utf8');
    assert.equal(
        source.includes('apps/playground'),
        false,
        `${relative(root, file)} must not depend on the playground application`,
    );
}

const directComponentImport =
    /(?:\bfrom\s+|\bimport\s*\()\s*['"][^'"]*packages\/(?:lsp-client|pyright-worker)\//;

for (const file of await testFiles(resolve(root, 'apps/playground/tests'))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
        source,
        directComponentImport,
        `${relative(root, file)} must test components through the application interface`,
    );
}

console.log('Application and component test boundaries are clean.');
