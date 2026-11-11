import { useEffect, useState } from "react";

// Categories hidden from the overview and graphs. Shared by both pages and remembered in this browser.
const KEY = "hiddenCats";
const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
};

export function useHidden() {
  const [hidden, setHidden] = useState(read);
  useEffect(() => {
    const sync = () => setHidden(read());
    addEventListener("hidden-cats", sync);
    return () => removeEventListener("hidden-cats", sync);
  }, []);
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
