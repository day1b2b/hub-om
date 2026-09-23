export function assertLegacyStorage(client: {
  query(sql: string): Promise<{ rows: Array<{ encrypted: boolean }> }>;
  end(): Promise<void>;
}): Promise<void>;
