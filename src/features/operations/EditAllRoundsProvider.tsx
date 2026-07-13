"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface EditAllRoundsContextValue {
  editAllSignal: number;
  triggerEditAll: () => void;
}

const EditAllRoundsContext = createContext<EditAllRoundsContextValue | null>(null);

export function EditAllRoundsProvider({ children }: { children: ReactNode }) {
  const [editAllSignal, setEditAllSignal] = useState(0);

  return (
    <EditAllRoundsContext.Provider
      value={{ editAllSignal, triggerEditAll: () => setEditAllSignal((current) => current + 1) }}
    >
      {children}
    </EditAllRoundsContext.Provider>
  );
}

export function useEditAllRoundsSignal() {
  return useContext(EditAllRoundsContext);
}
