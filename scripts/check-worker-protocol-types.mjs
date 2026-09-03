import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscPath = require.resolve('typescript/bin/tsc');
const outputDir = await mkdtemp(join(tmpdir(), 'mp-typing-worker-types-'));

function runTsc(args, cwd) {
    const result = spawnSync(process.execPath, [tscPath, ...args], {
        cwd,
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        process.stderr.write(result.stdout);
        process.stderr.write(result.stderr);
        process.exit(result.status ?? 1);
    }
}

try {
    runTsc([
        'packages/pyright-worker/src/messages.ts',
        '--declaration',
        '--emitDeclarationOnly',
        '--target', 'ES2020',
        '--module', 'ESNext',
        '--moduleResolution', 'Bundler',
        '--skipLibCheck',
        '--outDir', outputDir,
    ], new URL('..', import.meta.url));

    const [generated, committed] = await Promise.all([
        readFile(join(outputDir, 'messages.d.ts'), 'utf8'),
        readFile(new URL('../packages/pyright-worker/src/messages.d.ts', import.meta.url), 'utf8'),
    ]);

    assert.equal(
        committed.replaceAll('\r\n', '\n'),
        generated.replaceAll('\r\n', '\n'),
        'packages/pyright-worker/src/messages.d.ts is stale; regenerate it from messages.ts',
    );

    const packageDir = join(
        outputDir,
        'node_modules',
        '@mp-typing',
        'pyright-worker',
    );
    const packageSourceDir = join(packageDir, 'src');
    await mkdir(packageSourceDir, { recursive: true });
    await Promise.all([
        copyFile(
            new URL('../packages/pyright-worker/package.json', import.meta.url),
            join(packageDir, 'package.json'),
        ),
        copyFile(
            new URL('../packages/pyright-worker/src/messages.d.ts', import.meta.url),
            join(packageSourceDir, 'messages.d.ts'),
        ),
        copyFile(
            new URL('../packages/pyright-worker/src/declarations.d.ts', import.meta.url),
            join(packageSourceDir, 'declarations.d.ts'),
        ),
        writeFile(
            join(outputDir, 'consumer.ts'),
            [
                "import type { WorkerMessage as RootMessage } from '@mp-typing/pyright-worker';",
                "import type { WorkerMessage as SubpathMessage } from '@mp-typing/pyright-worker/messages';",
                'declare const message: RootMessage;',
                'const compatible: SubpathMessage = message;',
                'void compatible;',
                '',
            ].join('\n'),
        ),
    ]);
    runTsc([
        'consumer.ts',
        '--noEmit',
        '--strict',
        '--target', 'ES2020',
        '--module', 'NodeNext',
        '--moduleResolution', 'NodeNext',
        '--skipLibCheck',
    ], outputDir);

    console.log('Worker protocol declarations and package exports are up to date.');
} finally {
    await rm(outputDir, { recursive: true, force: true });
}
