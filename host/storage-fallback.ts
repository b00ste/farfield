// Wallet UI dependencies access localStorage directly. If browser policy denies
// it, keep their preferences in memory for this page only; never bypass the
// policy with another persistent storage mechanism.
try {
  const probe = `farfield-storage-probe-${Date.now()}`;
  window.localStorage.setItem(probe, "1");
  window.localStorage.removeItem(probe);
} catch {
  const values = new Map<string, string>();
  const memory: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(String(key)) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: memory,
  });
}
