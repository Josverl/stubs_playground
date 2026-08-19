# Changelog

## Unreleased

### Changed

- Default `typeshedPath` resolution now uses `/typeshed-micropython`.
- `WorkerTransport.listStubPackages(filters)` now accepts family, firmware version, port, and board filters.
- `WorkerTransport.getStubPackageCatalog(filters)` exposes available firmware versions and the detected default firmware version.
- Stub discovery without family or version filters now defaults to MicroPython's highest stable available firmware release.
- Stub package catalog entries now expose firmware family, compatible firmware versions, port, and board metadata.