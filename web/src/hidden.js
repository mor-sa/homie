import { useEffect, useState } from "react";

// Categories hidden from charts, remembered in this browser. The overview and graphs share one set
// ("dash"); the trips tab keeps its own, since there you'd hide e.g. flights to see spending on the ground.
const keyOf = (scope) => (scope === "dash" ? "hiddenCats" : `hiddenCats.${scope}`);

export function useHidden(scope = "dash") {
  const KEY = keyOf(scope);
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
  };
  const [hidden, setHidden] = useState(read);
  useEffect(() => {
    const sync = () => setHidden(read());
    addEventListener("hidden-cats", sync);
    return () => removeEventListener("hidden-cats", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [KEY]);
  const save = (next) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
    setHidden(next);
    dispatchEvent(new Event("hidden-cats"));
  };
  // "לא מסווג" is sent to the server as "__none"
  const key = (category) => (category === "לא מסווג" ? "__none" : category);
  return {
    hidden,
    hide: (category) => save([...new Set([...hidden, key(category)])]),
    show: (category) => save(hidden.filter((h) => h !== key(category))),
    showAll: () => save([]),
  };
}
