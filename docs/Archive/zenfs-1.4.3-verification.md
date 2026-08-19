# Verification of `@zenfs/archives` v1.4.3

Thanks for the fix. I retested v1.4.3 by enabling lazy mode on the worker's typeshed and board-stub ZIP mounts.  
Median startup over 3 runs was 4177.6 ms, with `mountFs` taking 101.0 ms.
Clearly that is no longer the bottleneck, and the worker's startup time is now dominated by the Pyright type-checking itself.

This resolves the blocker for us. Thanks again for the quick turnaround.

Minimal reproduction on `@zenfs/archives@1.4.3` + `@zenfs/core@2.6.3`:

```text
lazy=false statSync=OK  readSync=OK (32 bytes)  read=OK (32 bytes)
lazy=true  statSync=OK  readSync=OK (32 bytes)  read=OK (32 bytes)
```

I also mounted the real archives with `lazy: true` and recursively read every file synchronously:

```text
typeshed full:   files=4627 bytes=9558934 sha256=d34a947ad2cf301f
typeshed stdlib: files=584  bytes=2347194 sha256=ad97ee1d037dbdba
```

The full-archive result exactly matches the previous eager baseline.

Using the same steady-state protocol as before (3 warmups, 15 measured mounts with forced GC, 3 independent processes, pooled `n=45`), this run produced:

| archive | 1.0.5 eager | 1.4.3 eager | 1.4.3 lazy | lazy vs 1.0.5 eager |
|---|---:|---:|---:|---:|
| typeshed full | 865.9 ms | 1284.8 ms | 82.0 ms | 10.55x faster |
| typeshed stdlib-only | 58.1 ms | 181.1 ms | 15.6 ms | 3.71x faster |

The absolute timings were noisier than the earlier run, but the same-run comparison confirms that lazy mounting retains the large mount-time improvement while now supporting Pyright's synchronous reads.


