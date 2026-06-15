import { accessSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();

function existingModuleUrl(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js")
  ];

  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return pathToFileURL(candidate).href;
    } catch {
      // Try the next extension.
    }
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = existingModuleUrl(path.join(root, "src", specifier.slice(2)));
    if (resolved) return { shortCircuit: true, url: resolved };
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parentPath = fileURLToPath(context.parentURL);
    const resolved = existingModuleUrl(path.resolve(path.dirname(parentPath), specifier));
    if (resolved) return { shortCircuit: true, url: resolved };
  }

  return nextResolve(specifier, context);
}
