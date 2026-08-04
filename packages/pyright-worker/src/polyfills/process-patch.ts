// Process polyfill patches — must be imported first
(process as any).execArgv = [];
(process as any).platform = "linux";
(process as any).cwd = () => "/workspace";
(process as any).env = (process as any).env || {};
(process as any).versions = (process as any).versions || { node: "20.0.0" };
