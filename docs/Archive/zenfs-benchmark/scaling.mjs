// Maintainer's scaling reproduction from zen-fs/archives#19.
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';

import { zipSync } from 'fflate';
import { Zip } from '@zenfs/archives';
import { resolveMountConfig } from '@zenfs/core';

const LAZY = process.argv.includes('--lazy');
const pkgVersion = (name) => {
    try {
        return JSON.parse(
            readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8'),
        ).version;
    } catch {
        return 'n/a';
    }
};

function buildZip(entryCount) {
    const files = {};
    for (let i = 0; i < entryCount; i++) {
        files[`stdlib/pkg${i % 40}/module_${i}.pyi`] =
            new TextEncoder().encode(`def f_${i}(x: int) -> str: ...\n`);
    }
    const z = zipSync(files, { level: 6 });
    return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength);
}

console.log(`archives=${pkgVersion('@zenfs/archives')} core=${pkgVersion('@zenfs/core')} lazy=${LAZY}`);
console.log('entries  mount_ms  ms_per_entry');
let totalEntries = 0;
let totalMs = 0;
for (const n of [250, 500, 1000, 2000, 4000, 8000]) {
    const data = buildZip(n);
    const t0 = performance.now();
    await resolveMountConfig({ backend: Zip, data, ...(LAZY ? { lazy: true } : {}) });
    const ms = performance.now() - t0;
    totalEntries += n;
    totalMs += ms;
    console.log(`${String(n).padStart(7)}  ${ms.toFixed(0).padStart(8)}  ${(ms / n).toFixed(3).padStart(12)}`);
}
console.log(`Throughput: ${(totalEntries / totalMs).toFixed(0)} entries/ms`);
