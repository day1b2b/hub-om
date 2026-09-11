/** Old SQL import/export jobs cannot safely interpret encrypted columns. */
export async function assertLegacyStorage(client) {
  const result = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coaches' AND column_name = 'name_pii_index') AS encrypted");
  if (result.rows[0]?.encrypted) {
    await client.end();
    throw new Error("This legacy SQL job is incompatible with encrypted storage. Use the application's encrypted repository/sync API; do not bypass the storage checks.");
  }
}
