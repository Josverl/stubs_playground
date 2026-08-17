# Changelog

## Unreleased

### Changed

- Default `typeshedPath` resolution now uses `/typeshed-micropython`.
- `WorkerTransport.listStubPackages(filters)` now accepts family, runtime version, port, and board filters.
- `WorkerTransport.getStubPackageCatalog(filters)` exposes available runtime versions and the detected default runtime version.
- Stub discovery without family or version filters now defaults to MicroPython's highest stable available runtime release.
- Stub package catalog entries now expose runtime family, compatible runtime versions, port, and board metadata.