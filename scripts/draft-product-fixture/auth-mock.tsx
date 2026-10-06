import { useSyncExternalStore, type ReactNode } from "react";
const listeners = new Set<() => void>();
let state = { data: null as null | { browserDraftSubject: string; user: { email: string; name: string } }, status: "unauthenticated" };
export function fixtureSession(subject: string | null) {
  state = { data: subject ? { browserDraftSubject: subject, user: { email: `${subject.endsWith("A") ? "a" : "b"}@example.test`, name: "가상 사용자" } } : null, status: subject ? "authenticated" : "unauthenticated" };
  listeners.forEach(run => run());
}
const subscribe = (run: () => void) => { listeners.add(run); return () => { listeners.delete(run); }; };
export function useSession() { return useSyncExternalStore(subscribe, () => state, () => state); }
export function SessionProvider({ children }: { children: ReactNode }) { return children; }
export async function signOut() { fixtureSession(null); }
