import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");
const root = process.cwd(), fixture = path.join(root, "scripts/draft-product-fixture");
webpack({ mode: "development", devtool: false, entry: path.join(fixture, "entry.tsx"), output: { path: "/tmp/hub-om-draft-product-fixture", filename: "bundle.js" }, resolve: { extensions: [".tsx", ".ts", ".js", ".json"], alias: { "@": path.join(root, "src"), "next-auth/react$": path.join(fixture, "auth-mock.tsx"), "next/navigation$": path.join(fixture, "navigation-mock.tsx"), "next/link$": path.join(fixture, "link-mock.tsx") } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(fixture, "ts-loader.cjs") }] } }, (error, stats) => { if (error || stats.hasErrors()) { console.error(error ?? stats.toString({ all: false, errors: true })); process.exitCode = 1; } else console.log("Synthetic actual-component bundle ready."); });
