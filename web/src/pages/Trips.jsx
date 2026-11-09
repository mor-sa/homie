import { useEffect, useState } from "react";
import { api, ils, dateLabel } from "../api.js";
import { CategoryBars, ColumnChart, Donut, ListCard, Stat, txLabel } from "../components/charts.jsx";

export default function Trips({ meta, tripId, onGo, onChanged }) {
  const trips = meta.trips;
  const id = Number(tripId) || trips[0]?.id;
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setD(null);
    setErr(null);
    if (id) api.tripDashboard(id).then(setD, (e) => setErr(e.message));
  }, [id]);

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
      {d && <TripView d={d} onGo={onGo} onChanged={onChanged} />}
    </div>
  );
}

function TripView({ d, onGo }) {
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
        <Stat label="סה״כ הטיול" value={ils(d.total)} />
        <Stat label="ליום" value={ils(d.perDay)} />
        <Stat label="שולם מראש" value={ils(d.prepaid)} sub={<span className="text-muted">{d.prepaidCount} עסקאות לפני היציאה</span>} />
        <Stat label="לפי כרטיס" value={<span className="text-base">{d.byCard.map((c) => `${c.owner} ${ils(c.total)}`).join(" · ")}</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card p-4 lg:col-span-3">
          <h3 className="font-semibold">לפי קטגוריה</h3>
          <p className="mb-3 text-xs text-muted">לחיצה על קטגוריה מציגה תתי־קטגוריות</p>
          <CategoryBars rows={d.byCategory} total={d.total} />
        </section>
        <section className="card p-4 lg:col-span-2">
          <h3 className="mb-3 font-semibold">התפלגות</h3>
          <Donut rows={d.byCategory} />
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
          key: m.merchant, main: m.merchant, sub: `${m.count} עסקאות · ${m.category ?? "לא מסווג"}`, value: m.total }))} />
        <ListCard title="העסקאות הגדולות" rows={d.largest.map((x) => ({ key: x.id, main: x.note || x.merchant, sub: txLabel(x), value: x.amount }))} />
        <section className="card p-4">
          <h3 className="mb-3 font-semibold">השוואה בין טיולים</h3>
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
