// Webpack loads this isolated test loader through its CommonJS loader API.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require("typescript");
module.exports = function(source) { return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText; };
