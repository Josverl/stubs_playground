// Mount-cost benchmark for real archives.
// Usage: node mount.mjs <zip> [runs] [--lazy]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';

import { Zip } from '@zenfs/archives';
import { resolveMountConfig } from '@zenfs/core';

const pkgVersion = (name) => {
    try {
        return JSON.parse(
            readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8'),
        ).version;
    } catch {
        return 'n/a';
    }
};

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const lazy = process.argv.includes('--lazy');
const file = args[0];
const runs = Number(args[1] || 7);
const buffer = readFileSync(file);

const times = [];
for (let i = 0; i < runs; i++) {
    const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const start = performance.now();
    await resolveMountConfig({ backend: Zip, data, ...(lazy ? { lazy: true } : {}) });
    times.push(performance.now() - start);
}

const sorted = [...times].sort((a, b) => a - b);
const median = sorted[Math.floor(runs / 2)];
const mean = times.reduce((a, b) => a + b, 0) / runs;

console.log(
    `${basename(file).padEnd(22)} archives=${pkgVersion('@zenfs/archives')} core=${pkgVersion('@zenfs/core')} ` +
    `lazy=${lazy}  median=${median.toFixed(0)} ms  mean=${mean.toFixed(0)} ms  ` +
    `min=${sorted[0].toFixed(0)}  max=${sorted[runs - 1].toFixed(0)}`,
);
