const router = { refresh() {}, push(url: string) { document.getElementById("fixture-navigation")!.textContent = url; }, replace() {}, back() {} };
export function useRouter() { return router; }
export function usePathname() { return "/fixture"; }
export function useSearchParams() { return new URLSearchParams(window.location.search); }
