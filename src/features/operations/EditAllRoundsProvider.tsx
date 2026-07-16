"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type RowSaveHandler = () => Promise<boolean>;
type SaveAllState = "idle" | "saving" | "failed";

interface EditAllRoundsContextValue {
  editAllSignal: number;
  triggerEditAll: () => void;
  registerRow: (operationId: string, handler: RowSaveHandler) => void;
  unregisterRow: (operationId: string) => void;
  editingRowCount: number;
  saveAll: () => Promise<void>;
  saveAllState: SaveAllState;
  saveAllFailedCount: number;
}

const EditAllRoundsContext = createContext<EditAllRoundsContextValue | null>(null);

export function EditAllRoundsProvider({ children }: { children: ReactNode }) {
  const [editAllSignal, setEditAllSignal] = useState(0);
  const [editingRowCount, setEditingRowCount] = useState(0);
  const [saveAllState, setSaveAllState] = useState<SaveAllState>("idle");
  const [saveAllFailedCount, setSaveAllFailedCount] = useState(0);
  const rowHandlers = useRef(new Map<string, RowSaveHandler>());

  const registerRow = useCallback((operationId: string, handler: RowSaveHandler) => {
    rowHandlers.current.set(operationId, handler);
    setEditingRowCount(rowHandlers.current.size);
  }, []);

  const unregisterRow = useCallback((operationId: string) => {
    if (!rowHandlers.current.delete(operationId)) {
      return;
    }
    setEditingRowCount(rowHandlers.current.size);
  }, []);

  const saveAll = useCallback(async () => {
    const handlers = [...rowHandlers.current.values()];

    if (handlers.length === 0) {
      return;
    }

    setSaveAllState("saving");
    const results = await Promise.all(handlers.map((handler) => handler()));
    const failedCount = results.filter((succeeded) => !succeeded).length;

    setSaveAllFailedCount(failedCount);
    setSaveAllState(failedCount > 0 ? "failed" : "idle");
  }, []);

  return (
    <EditAllRoundsContext.Provider
      value={{
        editAllSignal,
        triggerEditAll: () => setEditAllSignal((current) => current + 1),
        registerRow,
        unregisterRow,
        editingRowCount,
        saveAll,
        saveAllState,
        saveAllFailedCount
      }}
    >
      {children}
    </EditAllRoundsContext.Provider>
  );
}

export function useEditAllRoundsSignal() {
  return useContext(EditAllRoundsContext);
}
