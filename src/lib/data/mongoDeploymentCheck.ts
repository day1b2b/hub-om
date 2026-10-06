import { MongoClient } from "mongodb";
import { configuredMongoUri } from "../mongodb/connection";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

export const MONGO_RUNTIME_BACKEND_SELECTORS = Object.freeze([
  "ACTIVITY_READ_BACKEND", "ADMIN_BACKUP_BACKEND", "ADMIN_DATABASE_BACKEND", "ADMIN_MAINTENANCE_BACKEND",
  "ANNOUNCEMENT_BACKEND", "CHANGES_BACKEND", "COACH_ACCESS_BACKEND", "COACH_ADMIN_BACKEND",
  "COACH_MANAGEMENT_BACKEND", "COACH_OPERATIONS_BACKEND", "COACH_PORTAL_BACKEND", "COACH_PUBLIC_BACKEND",
  "COACH_SYNC_BACKEND", "DRIVE_IMPORT_PAGE_BACKEND", "GOOGLE_SHEETS_IMPORT_BACKEND", "HEALTH_BACKEND",
  "HUBBOT_BACKEND", "IMPORT_PAGES_BACKEND", "IMPORT_PROMOTION_BACKEND", "IMPORT_STAGING_BACKEND",
  "INSTRUCTOR_SYNC_BACKEND", "INSTRUCTOR_WIKI_BACKEND", "LECTURE_FOLLOW_UP_BACKEND", "NOTION_IMPORT_BACKEND",
  "OM_REQUEST_PAGES_BACKEND", "OM_REQUEST_WRITE_BACKEND", "OM_SESSION_TEMPLATE_BACKEND", "OPERATION_PAGES_BACKEND",
  "OPERATION_WRITE_BACKEND", "OVERVIEW_PAGES_BACKEND", "SALES_LOOKUP_BACKEND", "SALES_SYNC_BACKEND",
  "SATISFACTION_BACKEND", "SOURCE_READ_STATUS_BACKEND", "USER_ADMIN_BACKEND",
] as const);

export type MongoDeploymentExpectation = "postgres" | "postgres-legacy-pii" | "mongodb-shadow";

/** Static deployment preflight only. It never connects to either database. */
export function checkMongoDeploymentEnvironment(
  expectation: MongoDeploymentExpectation,
  environment: MongoCompositionEnvironment,
) {
  const selectorExpectation = expectation === "mongodb-shadow" ? "mongodb-shadow" : "postgres";
  for (const name of MONGO_RUNTIME_BACKEND_SELECTORS) {
    const value = environment[name]?.trim() || "postgres";
    if (value !== selectorExpectation) throw new Error("MONGODB_DEPLOYMENT_CONFIGURATION_INVALID");
  }
  if (expectation === "postgres-legacy-pii" && environment.PII_ALLOW_PLAINTEXT_READS?.trim() !== "true")
    throw new Error("MONGODB_DEPLOYMENT_CONFIGURATION_INVALID");
  if (expectation === "mongodb-shadow") {
    if (environment.PII_ALLOW_PLAINTEXT_READS?.trim() !== "false") throw new Error("MONGODB_DEPLOYMENT_CONFIGURATION_INVALID");
    if (environment.RUN_DB_MIGRATIONS?.trim() === "true") throw new Error("MONGODB_DEPLOYMENT_CONFIGURATION_INVALID");
    try {
      requireMongoShadowComposition(environment);
      // Constructor parsing matches the runtime driver without opening a socket.
      new MongoClient(configuredMongoUri(environment));
    }
    catch { throw new Error("MONGODB_DEPLOYMENT_CONFIGURATION_INVALID"); }
  }
  return Object.freeze({ readyFor: expectation, selectorCount: MONGO_RUNTIME_BACKEND_SELECTORS.length });
}

export function parseMongoDeploymentExpectation(argv: readonly string[]): MongoDeploymentExpectation {
  if (argv.length !== 1) throw new Error("MONGODB_DEPLOYMENT_CONFIGURATION_INVALID");
  if (argv[0] === "--expect=postgres") return "postgres";
  if (argv[0] === "--expect=postgres-legacy-pii") return "postgres-legacy-pii";
  if (argv[0] === "--expect=mongodb-shadow") return "mongodb-shadow";
  throw new Error("MONGODB_DEPLOYMENT_CONFIGURATION_INVALID");
}
