import { useState } from "react";
import { api } from "../api.js";

export default function Import({ onImported, onGo }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [drag, setDrag] = useState(false);

  async function handle(files) {
    setBusy(true);
    for (const f of files) {
      try {
        const r = await api.import(f);
        setResults((x) => [{ name: f.name, ...r }, ...x]);
      } catch (e) {
        setResults((x) => [{ name: f.name, error: e.message }, ...x]);
      }
    }
    setBusy(false);
    onImported();
  }

  return (
    <div className="grid gap-4">
      <label
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => (e.preventDefault(), setDrag(false), handle([...e.dataTransfer.files]))}
        className={`card flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed p-10 text-center ${drag ? "border-series-1 bg-series-1/5" : ""}`}
      >
        <span className="text-lg font-semibold">{busy ? "מייבא…" : "גררו לכאן קובץ Excel, או לחצו לבחירה"}</span>
        <span className="max-w-lg text-sm text-ink-2">
          נתמכים: ייצוא “פירוט עסקאות וזיכויים” מאתר כאל, וקובץ ההוצאות מגוגל שיטס (לייבוא היסטוריה ולימוד הקטגוריות).
          אפשר לייבא את אותו קובץ שוב: עסקאות שכבר קיימות לא ייכנסו פעמיים.
        </span>
        <input type="file" accept=".xlsx" multiple className="hidden" disabled={busy}
          onChange={(e) => handle([...e.target.files])} />
      </label>

      {results.map((r, i) => (
        <div key={i} className="card p-4 text-sm">
          <div className="mb-1 font-semibold">{r.name}</div>
          {r.error ? (
            <p className="text-critical">{r.error}</p>
          ) : (
            <>
              <p className="text-ink-2">
                {r.kind === "history" ? "קובץ היסטוריה" : "פירוט עסקאות כאל"}
                {r.cards.length > 0 && <> · כרטיסים {r.cards.join(", ")}</>}
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                <li>נוספו: <b className="num">{r.added}</b></li>
                <li>כפילויות שדולגו: <b className="num">{r.duplicates}</b></li>
                <li>בקליטה: <b className="num">{r.pending}</b></li>
                <li>לאישור: <b className="num">{r.needsReview}</b></li>
              </ul>
              {r.needsReview > 0 && (
                <button onClick={() => onGo("review")} className="mt-3 rounded-lg bg-ink px-3 py-1.5 text-surface">למעבר על הסיווגים</button>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
