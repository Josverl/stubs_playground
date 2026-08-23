import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscPath = require.resolve('typescript/bin/tsc');
const repoRoot = new URL('..', import.meta.url);
const committedTypesDir = new URL('../packages/lsp-client/types/', import.meta.url);
const generatedDir = await mkdtemp(join(tmpdir(), 'mp-codemirror-lsp-client-types-'));

function runTsc(args, cwd) {
    const result = spawnSync(process.execPath, [tscPath, ...args], { cwd, encoding: 'utf8' });
    if (result.status !== 0) {
        process.stderr.write(result.stdout);
        process.stderr.write(result.stderr);
        process.exit(result.status ?? 1);
    }
}

// Type-checks the JSDoc (noImplicitAny) and regenerates declarations.
runTsc([
    '-p', 'packages/lsp-client/tsconfig.json',
    '--outDir', generatedDir,
], repoRoot);

const isDeclaration = (file) => file.endsWith('.d.ts') || file.endsWith('.d.mts');

const [generatedFiles, committedFiles] = await Promise.all([
    readdir(generatedDir),
    readdir(committedTypesDir),
]);

assert.deepEqual(
    committedFiles.filter(isDeclaration).sort(),
    generatedFiles.filter(isDeclaration).sort(),
    'packages/lsp-client/types is out of sync; run "npm run build:types --workspace @mp-codemirror/lsp-client"',
);

for (const file of generatedFiles.filter(isDeclaration)) {
    const [generated, committed] = await Promise.all([
        readFile(join(generatedDir, file), 'utf8'),
        readFile(new URL(file, committedTypesDir), 'utf8'),
    ]);
    assert.equal(
        committed.replaceAll('\r\n', '\n'),
        generated.replaceAll('\r\n', '\n'),
        `packages/lsp-client/types/${file} is stale; run "npm run build:types --workspace @mp-codemirror/lsp-client"`,
    );
}

// Verify the published surface is usable from TypeScript exactly as consumers resolve it.
const consumerDir = await mkdtemp(join(tmpdir(), 'mp-codemirror-lsp-client-consumer-'));
const packageDir = join(consumerDir, 'node_modules', '@mp-codemirror', 'lsp-client');
await mkdir(packageDir, { recursive: true });
await Promise.all([
    cp(new URL('../packages/lsp-client/package.json', import.meta.url), join(packageDir, 'package.json')),
    cp(new URL('../packages/lsp-client/src', import.meta.url), join(packageDir, 'src'), { recursive: true }),
    cp(committedTypesDir, join(packageDir, 'types'), { recursive: true }),
    cp(new URL('../node_modules/@codemirror', import.meta.url), join(consumerDir, 'node_modules', '@codemirror'), { recursive: true }),
    cp(new URL('../node_modules/@lezer', import.meta.url), join(consumerDir, 'node_modules', '@lezer'), { recursive: true }),
    cp(
        new URL('../node_modules/vscode-languageserver-types', import.meta.url),
        join(consumerDir, 'node_modules', 'vscode-languageserver-types'),
        { recursive: true },
    ),
]);

await writeFile(
    join(consumerDir, 'consumer.ts'),
    [
        "import type { EditorView } from '@codemirror/view';",
        'import {',
        '    createLSPClient,',
        '    createLSPPlugin,',
        '    notifyDocumentChange,',
        '    type LSPClientConfig,',
        '    type LSPClientResult,',
        '    type LSPPluginOptions,',
        '    type WorkspaceDiagnostic,',
        '    type InstalledStubPackage,',
        '    type StubPackageCatalogEntry,',
        "} from '@mp-codemirror/lsp-client';",
        '',
        'export async function start(workerUrl: string, view: EditorView): Promise<void> {',
        '    const config: LSPClientConfig = {',
        '        workerUrl,',
        '        typeCheckingMode: "standard",',
        '        diagnosticMode: "workspace",',
        '        onWorkspaceDiagnosticsChange(diagnostics: WorkspaceDiagnostic[]) {',
        '            void diagnostics.map((diagnostic) => diagnostic.fileName);',
        '        },',
        '    };',
        '    const runtime: LSPClientResult = await createLSPClient(config);',
        '    const pyrightVersion: string = runtime.pyrightVersion;',
        '    const options: LSPPluginOptions = { fileUri: "file:///workspace/main.py" };',
        '    const extensions = createLSPPlugin(runtime.client, view, options);',
        '    notifyDocumentChange(runtime.client, "file:///workspace/main.py", "x = 1", 2);',
        '    const packages: StubPackageCatalogEntry[] = await runtime.transport.listStubPackages();',
        '    const installed: InstalledStubPackage[] =',
        '        await runtime.transport.listInstalledStubPackages();',
        '    void [pyrightVersion, extensions, packages, installed];',
        '}',
        '',
    ].join('\n'),
);

runTsc([
    'consumer.ts',
    '--noEmit',
    '--strict',
    '--target', 'ES2020',
    '--module', 'ESNext',
    '--moduleResolution', 'Bundler',
    '--skipLibCheck',
], consumerDir);

console.log('LSP client JSDoc types, generated declarations, and TypeScript consumer surface are up to date.');
