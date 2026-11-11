import { useEffect, useState } from "react";
import { api, ils, dateLabel } from "../api.js";
import { CategoryBars, ColumnChart, Donut, ListCard, Stat, txLabel, withHidden } from "../components/charts.jsx";
import { useHidden } from "../hidden.js";

export default function Trips({ meta, tripId, onGo, onDrill, onChanged }) {
  const trips = meta.trips;
  const id = Number(tripId) || trips[0]?.id;
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  const hiding = useHidden("trips");
  const hiddenKey = hiding.hidden.join(",");
  const reload = () => api.tripDashboard(id, hiding.hidden).then(setD, (e) => setErr(e.message));
  useEffect(() => {
    setErr(null);
    if (id) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hiddenKey]);
  useEffect(() => setD(null), [id]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {trips.map((t) => (
          <button key={t.id} onClick={() => onGo("trips", String(t.id))}
            className={`rounded-lg border px-3 py-1.5 text-sm ${t.id === id ? "border-ink bg-ink text-surface" : "border-grid bg-surface hover:bg-grid/40"}`}>
            {t.name}
          </button>
        ))}
        <button onClick={() => onGo("settings")} className="rounded-lg border border-dashed border-grid px-3 py-1.5 text-sm text-ink-2">+ טיול חדש</button>
      </div>

      {!id && <p className="card p-8 text-center text-ink-2">עוד אין טיולים. מוסיפים טיול בהגדרות, וכל ההוצאות בתאריכים שלו מתויגות אליו.</p>}
      {err && <p className="text-critical">{err}</p>}
      {id && !d && !err && <p className="text-muted">טוען…</p>}
      {d && <TripView d={d} hiding={hiding} onGo={onGo} onDrill={(f) => onDrill({ trip: String(id), ...f })} onReload={async () => { await reload(); onChanged(); }} />}
    </div>
  );
}

function TripView({ d, hiding, onGo, onDrill, onReload }) {
  const t = d.trip;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-xl font-bold">{t.name}</h2>
        <span className="num text-ink-2">{dateLabel(t.start_date)}–{dateLabel(t.end_date)}</span>
        <span className="text-ink-2">· {d.days} ימים</span>
        {d.unreviewed > 0 && (
          <button onClick={() => onGo("review")} className="ms-auto flex items-center gap-2 text-sm text-ink-2 hover:text-ink">
            <span className="num rounded-full bg-series-2 px-2 py-0.5 text-white">{d.unreviewed}</span> עסקאות בטיול מחכות לסיווג
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="סה״כ הטיול" value={ils(d.total)} onClick={() => onDrill({})} sub={<span className="text-series-1">לכל העסקאות ↗</span>} />
        <Stat label="ליום" value={ils(d.perDay)} />
        <Stat label="שולם מראש" value={ils(d.prepaid)} sub={<span className="text-muted">{d.prepaidCount} עסקאות לפני היציאה</span>} />
        <Stat label="לפי כרטיס" value={<span className="text-base">{d.byCard.map((c) => `${c.owner} ${ils(c.total)}`).join(" · ")}</span>} />
      </div>

      {d.candidates.length > 0 && <Candidates d={d} onReload={onReload} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card p-4 lg:col-span-3">
          <h3 className="font-semibold">לפי קטגוריה</h3>
          <p className="mb-3 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>לחיצה על קטגוריה מציגה תתי־קטגוריות · העין מסתירה קטגוריה מהסכומים של הטיולים</span>
            {d.hidden.length > 1 && <button onClick={hiding.showAll} className="text-series-1 hover:underline">להחזיר את כל המוסתרות</button>}
          </p>
          <CategoryBars rows={withHidden(d.byCategory, d.hidden)} total={d.total} onPick={(category, sub) => onDrill({ category, sub })}
            onHide={hiding.hide} onShow={hiding.show} />
        </section>
        <section className="card p-4 lg:col-span-2">
          <h3 className="mb-3 font-semibold">התפלגות</h3>
          <Donut rows={d.byCategory} onPick={(category) => onDrill({ category })} />
          {d.currencies.length > 1 && (
            <ul className="mt-4 grid gap-1 text-sm">
              {d.currencies.map((c) => (
                <li key={c.currency} className="flex justify-between">
                  <span className="text-ink-2">{c.currency === "ILS" ? "בשקלים" : c.currency} · {c.count} עסקאות</span>
                  <span className="num">{ils(c.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card p-4">
        <h3 className="mb-1 font-semibold">לפי יום</h3>
        <ColumnChart
          data={d.daily}
          series={[{ key: "total", color: "var(--color-series-1)" }]}
          labelOf={(x) => dateLabel(x.date)}
          tipOf={(x) => <span className="text-ink-2">{dateLabel(x.date)}: <span className="num">{ils(x.total)}</span></span>}
        />
      </section>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ListCard title="איפה הכי הרבה כסף" rows={d.topMerchants.map((m) => ({
          key: m.merchant, main: m.merchant, sub: `${m.count} עסקאות · ${m.category ?? "לא מסווג"}`, value: m.total, onClick: () => onDrill({ q: m.merchant }) }))} />
        <ListCard title="העסקאות הגדולות" rows={d.largest.map((x) => ({ key: x.id, main: x.note || x.merchant, sub: txLabel(x), value: x.amount }))} />
        <section className="card p-4">
          <h3 className={d.hidden.length ? "font-semibold" : "mb-3 font-semibold"}>השוואה בין טיולים</h3>
          {d.hidden.length > 0 && <p className="mb-3 text-xs text-muted">בלי {d.hidden.map((h) => h.category).join(", ")}</p>}
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr><th className="text-start font-medium">טיול</th><th className="text-end font-medium">סה״כ</th><th className="text-end font-medium">ליום</th></tr></thead>
            <tbody>
              {d.allTrips.map((x) => (
                <tr key={x.id} className={x.id === t.id ? "font-semibold" : ""}>
                  <td className="py-1">{x.name} <span className="text-xs text-muted">({x.days} ימים)</span></td>
                  <td className="num text-end">{ils(x.total)}</td>
                  <td className="num text-end">{ils(x.perDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function Candidates({ d, onReload }) {
  const [busy, setBusy] = useState(false);
  const attach = async (ids) => {
    setBusy(true);
    for (const id of ids) await api.update(id, { trip_id: d.trip.id, applyToMerchant: false });
    await onReload();
    setBusy(false);
  };
  return (
    <section className="card border-series-2/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">אולי שייכות לטיול?</h3>
          <p className="text-xs text-muted">
            הוצאות מ־4 החודשים שלפני היציאה שנראות קשורות לטיול (טיסות, לינה, ביטוח, מט״ח) ולא מתויגות לאף טיול.
            הוצאה שמצורפת לטיול נספרת בו בלי קשר לתאריך.
          </p>
        </div>
        <button disabled={busy} onClick={() => attach(d.candidates.map((c) => c.id))}
          className="rounded-lg border border-grid px-3 py-1.5 text-sm hover:bg-grid/50 disabled:opacity-50">צירוף הכל</button>
      </div>
      <ul className="grid gap-1.5">
        {d.candidates.map((c) => (
          <li key={c.id} className="flex items-center gap-3 text-sm">
            <span className="num w-12 shrink-0 text-muted">{dateLabel(c.purchase_date)}</span>
            <span className="min-w-0 flex-1 truncate" title={c.merchant}>{c.merchant}</span>
            <span className={`num shrink-0 ${c.amount < 0 ? "text-good" : ""}`}>{ils(c.amount)}</span>
            <button disabled={busy} onClick={() => attach([c.id])}
              className="shrink-0 rounded-md border border-grid px-2.5 py-0.5 text-xs hover:bg-grid/50 disabled:opacity-50">צירוף</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
