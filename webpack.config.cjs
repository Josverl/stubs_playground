const path = require("path");
const webpack = require("webpack");
const fs = require("fs");
const os = require("os");

// Extract pyright version from the git tag in package.json
// e.g. "git+https://github.com/microsoft/pyright.git#1.1.386" → "1.1.386"
function getPyrightVersion() {
    const pkgJson = require("./packages/pyright-worker/package.json");
    const dep = pkgJson.devDependencies?.pyright || "";
    const tag = dep.includes("#") ? dep.split("#").pop() : "";
    return tag || "unknown";
}

module.exports = {
    entry: {
        pyright_worker: "./packages/pyright-worker/src/pyright-worker.ts",
    },
    output: {
        path: path.resolve(__dirname, "packages/pyright-worker/dist"),
        filename: "[name].js",
        clean: true,
    },
    target: "webworker",
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".json"],
        alias: {
            fs: require.resolve("@zenfs/core"),
            // Stub out Node-only Pyright deps that aren't needed in browser
            "@yarnpkg/fslib": path.resolve(__dirname, "packages/pyright-worker/src/polyfills/yarnpkg-fslib-stub.js"),
            "@yarnpkg/libzip": path.resolve(__dirname, "packages/pyright-worker/src/polyfills/yarnpkg-libzip-stub.js"),
            tmp: path.resolve(__dirname, "packages/pyright-worker/src/polyfills/tmp-stub.js"),
        },
        fallback: {
            assert: require.resolve("assert"),
            crypto: require.resolve("crypto-browserify"),
            stream: require.resolve("stream-browserify"),
            url: require.resolve("url"),
            zlib: require.resolve("browserify-zlib"),
            vm: require.resolve("vm-browserify"),
            os: require.resolve("os-browserify/browser"),
            util: require.resolve("util/"),
            v8: false,
            readline: false,
            worker_threads: false,
            child_process: false,
            process: false,
            path: require.resolve("path-browserify"),
        },
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: "process/browser",
            Buffer: ["buffer", "Buffer"],
        }),
        new webpack.DefinePlugin({
            __fs_constants: JSON.stringify(fs.constants),
            __os_constants: JSON.stringify(os.constants),
            __PYRIGHT_VERSION__: JSON.stringify(getPyrightVersion()),
        }),
    ],
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/i,
                loader: "ts-loader",
                options: {
                    transpileOnly: true,
                    ignoreDiagnostics: [2307],
                },
            },
            {
                test: /\.(zip|egg)$/,
                use: ["arraybuffer-loader"],
            },
        ],
    },
    performance: {
        maxAssetSize: 10 * 1024 * 1024, // 10 MB (Pyright is large)
        maxEntrypointSize: 10 * 1024 * 1024,
    },
};
