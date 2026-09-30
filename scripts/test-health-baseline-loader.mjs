/** Parent-executed test loader. Never copies source into the repository or prints git stderr. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

export const BASELINE = '35104776c1ae4f42696d06e0e836ead29a786fb3';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const edges = {
  'src/app/api/health/route.ts': { 'next/server': 'external', '@/lib/data/prisma': 'src/lib/data/prisma.ts' },
  'src/lib/data/prisma.ts': {
    '@/lib/privacy/crypto': 'src/lib/privacy/crypto.ts', '@/lib/privacy/database': 'src/lib/privacy/database.ts',
    '@/lib/activity/database': 'src/lib/activity/database.ts', '@prisma/adapter-pg': 'external',
    '@prisma/client': 'external', './dataRepositoryContext': 'src/lib/data/dataRepositoryContext.ts'
  },
  'src/lib/data/dataRepositoryContext.ts': { 'node:async_hooks': 'external' },
  'src/lib/privacy/crypto.ts': { 'node:crypto': 'external' },
  'src/lib/privacy/database.ts': { '@prisma/client': 'external', './fields': 'src/lib/privacy/fields.ts' },
  'src/lib/privacy/fields.ts': { './fields.json': 'src/lib/privacy/fields.json', '@prisma/client': 'external', './crypto': 'src/lib/privacy/crypto.ts' },
  'src/lib/privacy/fields.json': {},
  'src/lib/activity/database.ts': { '@/lib/privacy/fields': 'src/lib/privacy/fields.ts', './context': 'src/lib/activity/context.ts' },
  'src/lib/activity/context.ts': { 'node:async_hooks': 'external' }
};
const support = ['package.json', 'package-lock.json', 'prisma/schema.prisma', 'scripts/ts-loader.mjs'];
const records = new Map(), urls = new Map(), origins = new Map();
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 20 * 1024 * 1024 }); }
  catch { throw new Error('HEALTH_BASELINE_GIT_UNAVAILABLE'); }
}
function bytes(path) {
  assert.ok(Object.hasOwn(edges, path) || support.includes(path), 'HEALTH_BASELINE_UNREGISTERED_FILE');
  const blob = git(['rev-parse', `${BASELINE}:${path}`]).toString().trim();
  assert.match(blob, /^[0-9a-f]{40}$/);
  const source = git(['cat-file', 'blob', blob]);
  const computed = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
  assert.equal(computed, blob, 'HEALTH_BASELINE_BLOB_MISMATCH');
  records.set(path, { path, blob, sha256: sha256(source), runtime: Object.hasOwn(edges, path), edges: edges[path] ?? {} });
  return source;
}
export function verifyBaseline() {
  for (const path of Object.keys(edges)) bytes(path);
  for (const path of support) assert.ok(sha256(bytes(path)) === sha256(readFileSync(new URL(path, new URL('../', import.meta.url)))), 'HEALTH_BASELINE_SUPPORT_DRIFT');
  return { baseline: BASELINE, runtimeFiles: 9, files: [...records.values()], packages: ['next', '@prisma/client', '@prisma/adapter-pg', 'pg'].map(name => {
    const content = readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url));
    const entry = require.resolve(name === 'next' ? 'next/server.js' : name);
    return { name, version: JSON.parse(content).version, sha256: sha256(content), entrySha256: sha256(readFileSync(entry)) };
  }) };
}
export function originalURL(path) {
  assert.ok(Object.hasOwn(edges, path), 'HEALTH_BASELINE_UNREGISTERED_RUNTIME');
  if (!urls.has(path)) {
    const source = bytes(path);
    const json = path.endsWith('.json');
    const code = json ? source : Buffer.from(stripTypeScriptTypes(source.toString(), { mode: 'strip' }));
    const url = `data:${json ? 'application/json' : 'text/javascript'};base64,${code.toString('base64')}#${encodeURIComponent(path)}`;
    urls.set(path, url); origins.set(url, path);
  }
  return urls.get(path);
}
export function verifyCopy(path, value) { assert.ok(sha256(value) === sha256(bytes(path)), 'HEALTH_BASELINE_COPY_DRIFT'); }
registerHooks({ resolve(specifier, context, next) {
  const origin = origins.get(context.parentURL);
  if (origin) {
    const target = edges[origin][specifier];
    assert.ok(target, 'HEALTH_BASELINE_CURRENT_ESCAPE');
    if (target !== 'external') return { url: originalURL(target), shortCircuit: true };
    if (specifier === 'next/server') return { url: new URL('../node_modules/next/server.js', import.meta.url).href, shortCircuit: true };
    return next(specifier, { ...context, parentURL: import.meta.url });
  }
  // Exact ESM compatibility alias; real NextResponse, never a response substitute.
  if (specifier === 'next/server') return { url: new URL('../node_modules/next/server.js', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
export async function negativeControls() {
  for (const path of ['src/app/api/health/route.ts', 'src/lib/data/prisma.ts', 'scripts/ts-loader.mjs']) {
    assert.throws(() => verifyCopy(path, Buffer.concat([bytes(path), Buffer.from('\n// synthetic drift')])));
  }
  const url = `data:text/javascript;base64,${Buffer.from('import "@/lib/data/current-health-escape";').toString('base64')}#health-escape-probe`;
  origins.set(url, 'src/app/api/health/route.ts');
  try { await assert.rejects(import(url), /HEALTH_BASELINE_CURRENT_ESCAPE/); }
  finally { origins.delete(url); }
}
