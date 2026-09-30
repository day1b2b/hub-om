/** Connection liveness only; not schema, decryption or cutover readiness. */
export interface DatabaseHealthRepository {
  check(): Promise<void>;
}
