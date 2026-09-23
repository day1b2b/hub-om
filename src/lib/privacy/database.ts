import * as PrismaEnums from "@prisma/client";
import { Prisma, type PrismaClient } from "@prisma/client";
import { decryptField, encryptField, indexField, privacyFields } from "./fields";

// Dynamic Prisma model traversal is isolated here; callers retain the generated API.
type Row = Record<string, unknown>;
type Delegate = Record<string, (args: Row) => Promise<unknown>>;
const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
const writes = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert"]);
const record = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Uint8Array);
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [value];
const fieldPolicies = (model: string) => privacyFields[model]?.fields ?? {};
const relation = (model: string, field: string) => models.get(model)?.fields.find(f => f.name === field && f.kind === "object")?.type;
const hidden = (model: string) => new Set(Object.values(fieldPolicies(model)).flatMap(p => [p.index, p.storage].filter((v): v is string => !!v)));
const delegateFor = (client: object, model: string) => Reflect.get(client, model[0].toLowerCase() + model.slice(1)) as Delegate;
const MAX_SCAN = 20_000;
const MAX_SCAN_BYTES = 32 * 1024 * 1024;

// A necessary condition only: never narrow the result by partially negating a
// private predicate. Relations/compound keys are deliberately not optimized.
function concreteFilter(value: unknown): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0 && value.every(concreteFilter);
  if (record(value)) return Object.keys(value).length > 0 && Object.values(value).every(concreteFilter);
  return true;
}
function candidateWhere(model: string, value: unknown): Row {
  if (!record(value)) return {};
  const result: Row = {};
  for (const [field, filter] of Object.entries(value)) {
    if (filter === undefined) continue;
    if (field === "AND") {
      const children = array(filter).map(v => candidateWhere(model, v)).filter(v => Object.keys(v).length > 0);
      if (children.length) result.AND = children;
    }
    else if (field === "OR") {
      const branches = array(filter).map(v => candidateWhere(model, v));
      if (branches.every(v => Object.keys(v).length > 0)) result.OR = branches;
    } else if (field === "NOT") {
      // Keep each NOT conjunct only when its entire expression is unchanged.
      const safe = array(filter).filter(v => Object.keys(candidateWhere(model, v)).length > 0 && JSON.stringify(candidateWhere(model, v)) === JSON.stringify(v));
      if (safe.length) result.NOT = safe;
    } else if (concreteFilter(filter) && !fieldPolicies(model)[field] && models.get(model)?.fields.some(f => f.name === field && f.kind !== "object")) {
      result[field] = filter;
    }
  }
  return result;
}

function assertScanBudget(rows: Row[], message: string) {
  if (rows.length > MAX_SCAN) throw new Error(message);
  let bytes = 0;
  for (const row of rows) {
    bytes += Buffer.byteLength(JSON.stringify(row));
    if (bytes > MAX_SCAN_BYTES) throw new Error("Personal-data scan exceeds the supported byte limit; narrow the filter.");
  }
}

export function encryptData(model: string, input: unknown): unknown {
  if (Array.isArray(input)) return input.map(row => encryptData(model, row));
  if (!record(input)) return input;
  const result: Row = {};
  for (const [field, original] of Object.entries(input)) {
    if (hidden(model).has(field)) throw new Error("Encryption storage columns cannot be written directly.");
    const policy = fieldPolicies(model)[field];
    if (policy) {
      const value = policy.type !== "Json" && record(original) && "set" in original ? original.set : original;
      if (value === undefined) continue;
      result[policy.storage ?? field] = encryptField(model, field, value);
      if (policy.storage) result[field] = null;
      if (policy.index) result[policy.index] = indexField(model, field, value);
    } else {
      const related = relation(model, field);
      if (related && record(original)) {
        const nested: Row = {};
        for (const [operation, payload] of Object.entries(original)) {
          if (operation === "create") nested[operation] = encryptData(related, payload);
          else if (operation === "createMany" && record(payload)) nested[operation] = { ...payload, data: encryptData(related, payload.data) };
          else if (["update", "updateMany", "upsert", "connectOrCreate"].includes(operation)) {
            const entries = array(payload).map(entry => {
              if (!record(entry)) return entry;
              if ("data" in entry || "create" in entry || "update" in entry) {
                const next = { ...entry };
                for (const key of ["data", "create", "update"]) if (key in next) next[key] = encryptData(related, next[key]);
                return next;
              }
              return encryptData(related, entry);
            });
            nested[operation] = Array.isArray(payload) ? entries : entries[0];
          } else nested[operation] = payload;
        }
        result[field] = nested;
      } else result[field] = original;
    }
  }
  return result;
}

export function decryptRow(model: string, value: unknown): unknown {
  if (Array.isArray(value)) return value.map(row => decryptRow(model, row));
  if (!record(value)) return value;
  const result = { ...value };
  for (const [field, policy] of Object.entries(fieldPolicies(model))) {
    if (policy.storage && policy.storage in result) {
      if (result[policy.storage] != null) result[field] = decryptField(model, field, result[policy.storage]);
      else if (result[field] != null && process.env.PII_ALLOW_PLAINTEXT_READS !== "true") throw new Error("Unencrypted personal date found.");
    } else if (field in result) result[field] = decryptField(model, field, result[field]);
  }
  for (const field of hidden(model)) delete result[field];
  for (const [field, item] of Object.entries(result)) {
    const related = relation(model, field);
    if (related) result[field] = decryptRow(related, item);
  }
  return result;
}

async function privateFilter(client: object, model: string, field: string, filter: unknown, scope: Row): Promise<Row> {
  const policy = fieldPolicies(model)[field];
  if (filter === undefined) return {};
  if (filter === null) return { [policy.storage ?? field]: null };
  if (typeof filter === "string") {
    if (!policy.index) throw new Error("Unsupported encrypted field equality.");
    return { [policy.index]: indexField(model, field, filter) };
  }
  if (!record(filter) || policy.type !== "String") throw new Error(`Unsupported encrypted field filter: ${model}.${field}`);
  if (Object.keys(filter).every(k => ["equals", "in", "notIn", "not", "mode"].includes(k)) && filter.mode !== "insensitive") {
    const next: Row = {};
    for (const [operator, value] of Object.entries(filter)) {
      if (operator === "mode") continue;
      if (operator === "not" && record(value)) {
        // A nested scalar NOT can include substring predicates.
        const remaining = Object.fromEntries(Object.entries(filter).filter(([key]) => key !== "not"));
        return { AND: [await privateFilter(client, model, field, remaining, scope), { NOT: await privateFilter(client, model, field, value, scope) }] };
      }
      next[operator] = Array.isArray(value) ? value.map(v => indexField(model, field, v)) : indexField(model, field, value);
    }
    return { [policy.index!]: next };
  }
  // Substring/case-insensitive searches require authorized server-side decryption.
  // Bound the scan and fail explicitly, never silently truncate search results.
  const rows = await delegateFor(client, model).findMany({ where: scope, select: { [field]: true }, take: MAX_SCAN + 1 }) as Row[];
  assertScanBudget(rows, "Personal-data search is too broad; narrow the filter or use an exact match.");
  const matches = rows.filter(row => matchesString(decryptField(model, field, row[field]), filter)).map(row => row[field]);
  return { [field]: { in: matches.filter(v => v !== null) } };
}
function matchesString(input: unknown, filter: Row): boolean {
  if (input == null) return false;
  const normalize = (v: unknown) => filter.mode === "insensitive" ? String(v).toLowerCase() : String(v);
  const value = normalize(input);
  for (const [operator, raw] of Object.entries(filter)) {
    const expected = normalize(raw);
    if (operator === "mode") continue;
    if (operator === "contains" && !value.includes(expected)) return false;
    else if (operator === "startsWith" && !value.startsWith(expected)) return false;
    else if (operator === "endsWith" && !value.endsWith(expected)) return false;
    else if (operator === "equals" && value !== expected) return false;
    else if (operator === "in" && !(raw as unknown[]).some(v => normalize(v) === value)) return false;
    else if (operator === "notIn" && (raw as unknown[]).some(v => normalize(v) === value)) return false;
    else if (operator === "not" && (record(raw) ? matchesString(input, { ...raw, mode: filter.mode }) : value === expected)) return false;
    else if (!["contains", "startsWith", "endsWith", "equals", "in", "notIn", "not"].includes(operator)) throw new Error("Unsupported encrypted text filter.");
  }
  return true;
}
async function whereInput(client: object, model: string, value: unknown, scope = candidateWhere(model, value)): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(v => whereInput(client, model, v, scope)));
  if (!record(value)) return value;
  const result: Row = {};
  for (const [field, filter] of Object.entries(value)) {
    if (["AND", "OR", "NOT"].includes(field)) {
      const rewritten = await whereInput(client, model, filter, scope);
      result[field] = field === "AND" && result.AND ? [...array(result.AND), ...array(rewritten)] : rewritten;
    }
    else if (fieldPolicies(model)[field]) {
      const fragment = await privateFilter(client, model, field, filter, scope);
      if ("AND" in fragment) result.AND = [...array(result.AND ?? []), ...array(fragment.AND)];
      else Object.assign(result, fragment);
    }
    else if (relation(model, field)) {
      const related = relation(model, field)!;
      if (record(filter) && Object.keys(filter).some(k => ["some", "every", "none", "is", "isNot"].includes(k))) {
        result[field] = Object.fromEntries(await Promise.all(Object.entries(filter).map(async ([k, v]) => [k, await whereInput(client, related, v)])));
      } else result[field] = await whereInput(client, related, filter);
    } else {
      const unique = privacyFields[model]?.compoundKeys.find(fields => fields.join("_") === field && fields.some(f => fieldPolicies(model)[f]?.index));
      if (unique && record(filter)) {
        result[unique.map(f => fieldPolicies(model)[f]?.index ?? f).join("_")] = Object.fromEntries(unique.map(f => [fieldPolicies(model)[f]?.index ?? f, fieldPolicies(model)[f]?.index ? indexField(model, f, filter[f]) : filter[f]]));
      } else result[field] = filter;
    }
  }
  return result;
}
function privateOrdering(model: string, args: Row): boolean {
  return array(args.orderBy ?? []).some(order => record(order) && Object.keys(order).some(field => field in fieldPolicies(model)));
}
async function prepareArgs(client: object, model: string, original: Row): Promise<Row> {
  const args = { ...original };
  for (const key of ["where", "cursor"]) if (key in args) args[key] = await whereInput(client, model, args[key]);
  for (const projection of ["select", "include"]) {
    if (!record(args[projection])) continue;
    const next = { ...args[projection] };
    for (const [field, selection] of Object.entries(next)) {
      const related = relation(model, field);
      if (field === "_count" && record(selection) && record(selection.select)) {
        const countSelect: Row = {};
        for (const [countField, countSelection] of Object.entries(selection.select)) {
          const countModel = relation(model, countField);
          countSelect[countField] = countModel && record(countSelection) ? await prepareArgs(client, countModel, countSelection) : countSelection;
        }
        next[field] = { ...selection, select: countSelect };
      }
      if (related && record(selection)) next[field] = await prepareArgs(client, related, selection);
      if (projection === "select" && selection && fieldPolicies(model)[field]?.storage) next[fieldPolicies(model)[field].storage!] = true;
    }
    args[projection] = next;
  }
  if (record(args.omit)) {
    const omitted: Row = { ...args.omit };
    for (const [field, policy] of Object.entries(fieldPolicies(model))) if (omitted[field] && policy.storage) omitted[policy.storage] = true;
    args.omit = omitted;
  }
  if (privateOrdering(model, original)) {
    if (original.cursor || original.distinct) throw new Error("Encrypted ordering does not support cursors or distinct.");
    const orders = array(original.orderBy).flatMap(v => record(v) ? Object.keys(v) : []);
    if (record(args.select)) for (const field of orders) args.select[field] = true;
    delete args.orderBy; delete args.skip; args.take = MAX_SCAN + 1;
  }
  return args;
}
function finish(model: string, original: Row, value: unknown): unknown {
  if (Array.isArray(value)) {
    let rows = value.map(row => finish(model, { ...original, orderBy: undefined }, row)) as Row[];
    if (privateOrdering(model, original)) {
      if (rows.length > MAX_SCAN) throw new Error("Personal-data ordering exceeds the supported scan limit.");
      rows.sort((a, b) => {
        for (const order of array(original.orderBy)) {
          if (!record(order)) continue;
          for (const [field, direction] of Object.entries(order)) {
            if (typeof direction !== "string") throw new Error("Unsupported encrypted ordering.");
            const av = a[field], bv = b[field];
            const fieldType = models.get(model)?.fields.find(f => f.name === field);
            const enumValues = fieldType?.kind === "enum" ? Object.values(Reflect.get(PrismaEnums, fieldType.type) ?? {}) : [];
            const cmp = av != null && bv != null && enumValues.length ? enumValues.indexOf(av) - enumValues.indexOf(bv) : av == null ? (bv == null ? 0 : 1) : bv == null ? -1 : typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "ko");
            if (cmp) return direction === "desc" ? -cmp : cmp;
          }
        }
        return 0;
      });
      const take = original.take as number | undefined;
      if (take !== undefined && take < 0) throw new Error("Negative take is unsupported for encrypted ordering.");
      const skip = (original.skip as number) ?? 0;
      rows = rows.slice(skip, take === undefined ? undefined : skip + take);
      if (record(original.select)) rows = rows.map(row => Object.fromEntries(Object.entries(row).filter(([f]) => original.select && (original.select as Row)[f])));
    }
    return rows;
  }
  if (!record(value)) return value;
  const result = { ...value };
  for (const [field, item] of Object.entries(value)) {
    const related = relation(model, field);
    const selection = (record(original.select) ? original.select[field] : undefined) ?? (record(original.include) ? original.include[field] : undefined);
    if (related) result[field] = finish(related, record(selection) ? selection : {}, item);
  }
  return result;
}
async function rewriteNestedWhere(client: object, model: string, input: unknown): Promise<unknown> {
  if (Array.isArray(input)) return Promise.all(input.map(v => rewriteNestedWhere(client, model, v)));
  if (!record(input)) return input;
  const result = { ...input };
  for (const [field, payload] of Object.entries(result)) {
    const related = relation(model, field);
    if (!related || !record(payload)) continue;
    const nested: Row = {};
    for (const [op, entries] of Object.entries(payload)) {
      const next = await Promise.all(array(entries).map(async entry => {
        if (["connect", "disconnect", "delete", "deleteMany", "set"].includes(op)) return whereInput(client, related, entry);
        if (!record(entry)) return entry;
        if (op === "create") return rewriteNestedWhere(client, related, entry);
        const copy = { ...entry };
        if ("where" in copy) copy.where = await whereInput(client, related, copy.where);
        for (const k of ["create", "update", "data"]) if (k in copy) copy[k] = await rewriteNestedWhere(client, related, copy[k]);
        return copy;
      }));
      nested[op] = Array.isArray(entries) ? next : next[0];
    }
    result[field] = nested;
  }
  return result;
}

// Top-level sorted reads keep large JSON/attachments out of the candidate set.
// A repeatable-read transaction on the root client keeps the two reads consistent.
async function sortedRead(client: object, model: string, original: Row, op: string): Promise<unknown> {
  const primaryColumn = privacyFields[model]?.primaryKey;
  const primary = models.get(model)?.fields.find(f => (f.dbName ?? f.name) === primaryColumn)?.name;
  if (!primary) throw new Error("Encrypted ordering requires a single primary key.");
  const select: Row = { [primary]: true };
  for (const order of array(original.orderBy)) {
    if (!record(order)) throw new Error("Unsupported encrypted ordering.");
    for (const [field, direction] of Object.entries(order)) {
      if (!["asc", "desc"].includes(String(direction)) || relation(model, field)) throw new Error("Unsupported encrypted ordering.");
      select[field] = true;
    }
  }
  const candidateArgs = await prepareArgs(client, model, { ...original, select, include: undefined, omit: undefined });
  const delegate = delegateFor(client, model);
  const candidates = await delegate.findMany(candidateArgs) as Row[];
  assertScanBudget(candidates, "Personal-data ordering exceeds the supported scan limit; narrow the filter.");
  const page = finish(model, { ...original, select: undefined, include: undefined }, decryptRow(model, candidates)) as Row[];
  const ids = (op.startsWith("findFirst") ? page.slice(0, 1) : page).map(row => row[primary]);
  if (!ids.length) {
    if (op.endsWith("OrThrow")) throw new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: Prisma.prismaVersion.client });
    return op.startsWith("findFirst") ? null : [];
  }
  const payloadArgs = await prepareArgs(client, model, { ...original, where: undefined, orderBy: undefined, take: undefined, skip: undefined });
  payloadArgs.where = { AND: [candidateArgs.where ?? {}, { [primary]: { in: ids } }] };
  if (record(payloadArgs.select)) payloadArgs.select[primary] = true;
  if (record(payloadArgs.omit)) payloadArgs.omit[primary] = false;
  const payload = finish(model, { ...original, orderBy: undefined }, decryptRow(model, await delegate.findMany(payloadArgs))) as Row[];
  const byId = new Map(payload.map(row => [row[primary], row]));
  const result = ids.flatMap(id => {
    const row = byId.get(id);
    if (!row) return [];
    if ((record(original.select) && !original.select[primary]) || (record(original.omit) && original.omit[primary])) {
      const projected = { ...row }; delete projected[primary]; return [projected];
    }
    return [row];
  });
  if (op.startsWith("findFirst")) {
    if (!result.length && op.endsWith("OrThrow")) throw new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: Prisma.prismaVersion.client });
    return result[0] ?? null;
  }
  return result;
}

export function withPrivacyDatabase<T extends object>(client: T): T {
  const delegates = new Map<string, unknown>();
  return new Proxy(client, {
    get(target, property) {
      const member = Reflect.get(target, property);
      if (property === "$transaction") return (callback: unknown, options?: unknown) => {
        if (typeof callback !== "function") throw new Error("Use callback transactions with field encryption.");
        return (member as (...args: unknown[]) => unknown).call(target, (tx: object) => callback(withPrivacyDatabase(tx)), options);
      };
      const model = typeof property === "string" ? [...models.keys()].find(m => m[0].toLowerCase() + m.slice(1) === property) : undefined;
      if (!model) return typeof member === "function" ? member.bind(target) : member;
      if (!delegates.has(model)) delegates.set(model, new Proxy(member as Delegate, {
        get(delegate, operation) {
          const fn = Reflect.get(delegate, operation);
          if (typeof fn !== "function") return fn;
          return async (original: Row = {}) => {
            const op = String(operation);
            if (["findMany", "findFirst", "findFirstOrThrow"].includes(op) && privateOrdering(model, original)) {
              const transaction = Reflect.get(target, "$transaction");
              if (typeof transaction === "function") {
                return transaction.call(target, (tx: object) => sortedRead(tx, model, original, op), { isolationLevel: "RepeatableRead" });
              }
              // Inside a caller-owned transaction retain the single payload read;
              // its isolation level may not guarantee a stable second snapshot.
            }
            const args = await prepareArgs(target, model, original);
            if (original.distinct && array(original.distinct).some(f => fieldPolicies(model)[String(f)])) throw new Error("Use blind indexes for encrypted distinct queries.");
            if (op === "groupBy" && array(original.by).some(f => fieldPolicies(model)[String(f)])) throw new Error("Use blind indexes for encrypted groupBy queries.");
            if (writes.has(op)) {
              for (const key of ["data", "create", "update"]) if (key in args) args[key] = await rewriteNestedWhere(target, model, encryptData(model, args[key]));
            }
            if (["aggregate", "count"].includes(op) && ["_min", "_max", "_sum", "_avg"].some(k => record(original[k]) && Object.keys(original[k]).some(f => fieldPolicies(model)[f]))) throw new Error("Aggregating encrypted values is unsupported.");
            const firstSorted = op.startsWith("findFirst") && privateOrdering(model, original);
            const result = await (firstSorted ? delegate.findMany(args) : fn.call(delegate, args));
            const rows = finish(model, original, decryptRow(model, result));
            if (firstSorted) {
              const first = (rows as unknown[])[0];
              if (!first && op.endsWith("OrThrow")) throw new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: Prisma.prismaVersion.client });
              return first ?? null;
            }
            return rows;
          };
        }
      }));
      return delegates.get(model);
    }
  });
}
export const encryptedClient = (client: PrismaClient): PrismaClient => withPrivacyDatabase(client);
