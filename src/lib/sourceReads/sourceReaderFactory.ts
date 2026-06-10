import { DisabledOperationSourceReader } from "./disabledSourceReader";
import type { OperationSourceReader } from "./sourceReadTypes";

export function getOperationSourceReader(): OperationSourceReader {
  return new DisabledOperationSourceReader();
}
