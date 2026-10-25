import type { MongoClient } from "mongodb";
import { mongoDatabaseRoleOf } from "../mongodb/connection";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import type { DatabaseHealthRepository } from "./databaseHealthRepository";
import { mongoFailureCode } from "./mongoOperationPrimitives";

/** Explicit connection health. The caller owns the client; no schema/collection preparation.
 * An optional read-only readiness check runs after the ping, so a deploy whose contract no longer matches the
 * stored collections fails its health check instead of replacing a working container. */
export class MongoDatabaseHealthRepository implements DatabaseHealthRepository {
  private readonly client: MongoClient;
  private readonly databaseName: string;
  private readonly readiness?: () => Promise<void>;

  constructor(client: MongoClient, databaseName: string, readiness?: () => Promise<void>) {
    try {
      if (!mongoDatabaseRoleOf(databaseName)) throw new Error("DATABASE_HEALTH_CHECK_FAILED");
      this.databaseName = databaseName;
      this.client = client;
      this.readiness = readiness;
    } catch { throw new Error("DATABASE_HEALTH_CHECK_FAILED"); }
  }

  async check(): Promise<void> {
    try {
      assertPrivacyConfiguration();
      await this.client.db(this.databaseName).command({ ping: 1 }, { timeoutMS: 5000 });
    } catch { throw new Error("DATABASE_HEALTH_CHECK_FAILED"); }
    if (!this.readiness) return;
    try { await this.readiness(); }
    catch (error) {
      console.error("DATABASE_HEALTH_READINESS_FAILED", mongoFailureCode(error));
      throw new Error("DATABASE_HEALTH_CHECK_FAILED");
    }
  }
}
