# Changelog

## Unreleased

### Added

- TypeScript declarations generated from the JSDoc are now published in `types/`
  and exposed through the package `types` export condition. JavaScript
  consumption is unchanged.
- Public types (`LSPClientConfig`, `LSPClientResult`, `LSPPluginOptions`,
  `WorkspaceDiagnostic`, `WorkerTransportOptions`, `StubPackageCatalogEntry`,
  `StubPackageRelease`, `InstalledStubPackage`, `WorkerFsEntry`, `LSPTransport`,
  `LSPCompletionItem`, `CodeMirrorCompletionOption`) are re-exported from the
  package entry point.

### Fixed

- `createLSPClient` no longer forwards `diagnosticMode` to the worker transport,
  which never accepted it. Pyright still receives the setting through the client
  configuration, so behavior is unchanged.

### Changed

- Default `typeshedPath` resolution now uses `/typeshed-micropython`.
- `WorkerTransport.listStubPackages(filters)` now accepts family, firmware version, port, and board filters.
- `WorkerTransport.getStubPackageCatalog(filters)` exposes available firmware versions and the detected default firmware version.
- Stub discovery without family or version filters now defaults to MicroPython's highest stable available firmware release.
- Stub package catalog entries now expose firmware family, compatible firmware versions, port, and board metadata.