import { useCallback, useEffect, useState } from "react";
import { api, monthLabel } from "./api.js";
import Dashboard from "./pages/Dashboard.jsx";
import Transactions from "./pages/Transactions.jsx";
import Import from "./pages/Import.jsx";
import Trips from "./pages/Trips.jsx";
import Graphs from "./pages/Graphs.jsx";
import Settings from "./pages/Settings.jsx";

const TABS = [
  { id: "dashboard", label: "סקירה" },
  { id: "graphs", label: "גרפים" },
  { id: "trips", label: "טיולים" },
  { id: "review", label: "לאישור" },
  { id: "transactions", label: "עסקאות" },
  { id: "import", label: "ייבוא" },
  { id: "settings", label: "הגדרות" },
];

// #tab/param?filters: param is a month (YYYY-MM), a year (YYYY) or a trip id;
// filters (category, sub, trip, card, q, fixed, notrips, weekday) drive the transactions page
const readHash = () => {
  const [path, query = ""] = location.hash.slice(1).split("?");
  const [tab, param] = decodeURIComponent(path).split("/");
  return { tab: TABS.some((t) => t.id === tab) ? tab : "dashboard", param, filters: Object.fromEntries(new URLSearchParams(query)) };
};

export default function App() {
  const [{ tab, param, filters }, setRoute] = useState(readHash);
  const [meta, setMeta] = useState(null);
  const [reviewCount, setReviewCount] = useState(0);

  const refreshMeta = useCallback(async () => {
    const m = await api.meta();
    setMeta(m);
    const r = await api.transactions({ review: "1" });
    setReviewCount(r.length);
  }, []);

  useEffect(() => {
    refreshMeta();
    const onHash = () => setRoute(readHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [refreshMeta]);

  if (!meta) return <div className="p-8 text-muted">טוען…</div>;

  const isPeriod = (p) => /^\d{4}(-\d{2})?$/.test(p ?? "");
  // the graphs tab opens on a year; the others on the last full month
  const period = isPeriod(param) ? param : tab === "graphs" ? meta.defaultMonth.slice(0, 4) : meta.defaultMonth;
  const go = (t, p, f) => {
    const q = f ? new URLSearchParams(Object.entries(f).filter(([, v]) => v != null && v !== "")).toString() : "";
    location.hash = `${t}/${p ?? (t === "dashboard" || t === "transactions" ? period : t === "graphs" ? period.slice(0, 4) : "")}${q ? "?" + q : ""}`;
  };
  // drill-down from a chart: open the transactions page with these filters
  const drill = (f, p = period) => go("transactions", p, f);
  const showPeriod = tab === "dashboard" || tab === "transactions" || tab === "graphs";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-grid bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <h1 className="text-lg font-bold">הוצאות הבית</h1>
          <nav className="flex max-w-full gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => go(t.id)}
                className={`relative whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t.id ? "bg-ink text-surface" : "text-ink-2 hover:bg-grid/60"}`}>
                {t.label}
                {t.id === "review" && reviewCount > 0 && (
                  <span className="num ms-1.5 rounded-full bg-series-2 px-1.5 text-xs text-white">{reviewCount}</span>
                )}
              </button>
            ))}
          </nav>
          {showPeriod && meta.months.length > 0 && (
            <PeriodNav period={period} meta={meta} onGo={(p) => go(tab, p, tab === "transactions" ? filters : undefined)} />
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {meta.months.length === 0 && !["import", "settings"].includes(tab) ? (
          <div className="card p-8 text-center">
            <p className="mb-4 text-ink-2">עוד אין נתונים. התחילו בייבוא קובץ ההוצאות מגוגל שיטס ואז פירוט עסקאות מחברת האשראי.</p>
            <button onClick={() => go("import")} className="rounded-lg bg-ink px-4 py-2 text-surface">לייבוא</button>
          </div>
        ) : tab === "dashboard" ? (
          <Dashboard key={period} month={period} onGo={go} onDrill={drill} />
        ) : tab === "graphs" ? (
          <Graphs key={period} period={period} onGo={go} onDrill={drill} />
        ) : tab === "trips" ? (
          <Trips meta={meta} tripId={param} onGo={go} onDrill={drill} onChanged={refreshMeta} />
        ) : tab === "review" ? (
          <Transactions key="review" meta={meta} reviewMode onChanged={refreshMeta} />
        ) : tab === "transactions" ? (
          <Transactions key={period + JSON.stringify(filters)} meta={meta} month={period} filters={filters}
            onFilters={(f) => go("transactions", period, f)} onChanged={refreshMeta} />
        ) : tab === "import" ? (
          <Import meta={meta} onImported={refreshMeta} onGo={go} />
        ) : (
          <Settings meta={meta} onChanged={refreshMeta} />
        )}
      </main>
    </div>
  );
}

// Previous / next month (or year), like Wikipedia's "« previous | next »". In RTL the earlier period
// is on the right. ←/→ on the keyboard move too (left = later, matching the arrows on screen).
function PeriodNav({ period, meta, onGo }) {
  const isYear = /^\d{4}$/.test(period);
  const shift = (d) => {
    if (isYear) return String(Number(period) + d);
    const [y, m] = period.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7);
  };
  const list = isYear ? meta.years.map((y) => y.year) : meta.months.map((m) => m.month);
  const [min, max] = [list.at(-1), list[0]];
  const prev = shift(-1), next = shift(1);
  const canPrev = prev >= min, canNext = next <= max;

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, select, textarea") || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowRight" && canPrev) onGo(prev);
      if (e.key === "ArrowLeft" && canNext) onGo(next);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [prev, next, canPrev, canNext]);

  const btn = "flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-grid/60 disabled:opacity-30 disabled:hover:bg-transparent";
  const unit = isYear ? "שנה" : "חודש";
  return (
    <div className="ms-auto flex items-center gap-1">
      <button className={btn} disabled={!canPrev} onClick={() => onGo(prev)} title={`${unit} קודם: ${monthLabel(prev)} (→)`}>
        <span aria-hidden>»</span><span className="hidden sm:inline">{monthLabel(prev, !isYear)}</span>
        <span className="sr-only">{unit} קודם</span>
      </button>
      <select value={period} onChange={(e) => onGo(e.target.value)}
        className="rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm" aria-label="תקופה">
        <optgroup label="חודשים">
          {meta.months.map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
        </optgroup>
        <optgroup label="שנים">
          {meta.years.map((y) => <option key={y.year} value={y.year}>{monthLabel(y.year)}</option>)}
        </optgroup>
      </select>
      <button className={btn} disabled={!canNext} onClick={() => onGo(next)} title={`${unit} הבא: ${monthLabel(next)} (←)`}>
        <span className="hidden sm:inline">{monthLabel(next, !isYear)}</span><span aria-hidden>«</span>
        <span className="sr-only">{unit} הבא</span>
      </button>
    </div>
  );
}
