import type { MongoClient } from "mongodb";
import { shadowDatabaseName } from "../mongodb/connection";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import type { DatabaseHealthRepository } from "./databaseHealthRepository";

/** Explicit connection health only. The caller owns the client; no schema/collection preparation. */
export class MongoDatabaseHealthRepository implements DatabaseHealthRepository {
  private readonly client: MongoClient;
  private readonly databaseName: string;

  constructor(client: MongoClient, databaseName: string) {
    try {
      this.databaseName = shadowDatabaseName({ MONGODB_SHADOW_DATABASE: databaseName });
      this.client = client;
    } catch { throw new Error("DATABASE_HEALTH_CHECK_FAILED"); }
  }

  async check(): Promise<void> {
    try {
      assertPrivacyConfiguration();
      await this.client.db(this.databaseName).command({ ping: 1 }, { timeoutMS: 5000 });
    } catch { throw new Error("DATABASE_HEALTH_CHECK_FAILED"); }
  }
}
