import fieldPolicy from "./fields.json" with { type: "json" };
import { Prisma } from "@prisma/client";
import { blindIndex, decrypt, encrypt, isEncrypted } from "./crypto";
export type FieldPolicy = { column: string; type: string; nullable: boolean; index?: string; indexColumn?: string; storage?: string; storageColumn?: string; allowAuditMetadata?: boolean };
export const privacyFields = fieldPolicy as Record<string, { table: string; primaryKey: string; compoundKeys: string[][]; fields: Record<string, FieldPolicy> }>;
export const fieldContext = (model: string, field: string) => `${model}.${field}`;
export function encryptField(model: string, field: string, value: unknown): unknown {
  if (value === null || value === undefined || value === Prisma.DbNull) return value;
  const policy = privacyFields[model].fields[field];
  if (policy.type === "Json") return { __pii: encrypt(JSON.stringify(value === Prisma.JsonNull ? null : value), fieldContext(model, field)) };
  if (policy.type === "Bytes") return Buffer.from(encrypt(Buffer.from(value as Uint8Array).toString("base64"), fieldContext(model, field)));
  if (policy.type === "DateTime") return encrypt(new Date(value as string | Date).toISOString(), fieldContext(model, field));
  if (typeof value !== "string") throw new Error(`Invalid personal field type: ${model}.${field}`);
  // Even envelope-looking user text is data. Only the migration may skip verified ciphertext.
  return encrypt(value, fieldContext(model, field));
}
export function decryptField(model: string, field: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const policy = privacyFields[model].fields[field];
  if (policy.type === "Json") {
    if (typeof value === "object" && "__pii" in value && typeof value.__pii === "string") return JSON.parse(decrypt(value.__pii, fieldContext(model, field)));
    if (policy.allowAuditMetadata || process.env.PII_ALLOW_PLAINTEXT_READS === "true") return value;
    throw new Error("Unencrypted personal JSON found.");
  }
  if (policy.type === "Bytes") return Buffer.from(decrypt(Buffer.from(value as Uint8Array).toString(), fieldContext(model, field)), "base64");
  if (policy.type === "DateTime") return new Date(decrypt(String(value), fieldContext(model, field)));
  return decrypt(String(value), fieldContext(model, field));
}
export function indexField(model: string, field: string, value: unknown): string | null {
  return value == null ? null : blindIndex(String(value), fieldContext(model, field));
}
export function storedEncrypted(policy: FieldPolicy, value: unknown): boolean {
  if (value == null) return true;
  if (policy.type === "Json") return typeof value === "object" && "__pii" in value && isEncrypted(value.__pii);
  if (policy.type === "Bytes") return isEncrypted(Buffer.from(value as Uint8Array).toString());
  return isEncrypted(value);
}
