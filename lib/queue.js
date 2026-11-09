/** One in-memory FIFO slot shared by model-heavy work: analysis, articles and share posters. */
export function createTaskQueue() {
  let current = null;
  const waiting = [];
  let disposed = false;

  function grant(entry) {
    let released = false;
    current = entry.key;
    entry.resolve(() => {
      if (released) return;
      released = true;
      if (current === entry.key) current = null;
      const next = waiting.shift();
      if (next) grant(next);
    });
  }

  return {
    /**
     * Join the queue synchronously so concurrent callers get a stable order.
     * @returns `immediate` when the slot was free, and `ready`, resolving to a release function.
     */
    enter(key) {
      if (disposed) return { immediate: false, ready: Promise.reject(new Error("插件已卸载")) };
      let resolve, reject;
      const ready = new Promise((ok, fail) => { resolve = ok; reject = fail; });
      const entry = { key, resolve, reject };
      const immediate = current === null && waiting.length === 0;
      if (immediate) grant(entry); else waiting.push(entry);
      return { immediate, ready };
    },
    /** @returns the 1-based waiting position, or 0 when the key is not waiting. */
    position(key) {
      return waiting.findIndex((entry) => entry.key === key) + 1;
    },
    dispose() {
      disposed = true;
      current = null;
      for (const entry of waiting.splice(0)) entry.reject(new Error("插件已卸载"));
    },
  };
}
