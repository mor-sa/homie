import { useEffect, useState } from "react";
import { api, ils, monthLabel } from "../api.js";
import { CategoryBars, ColumnChart, Donut, ListCard, Stat, txLabel } from "../components/charts.jsx";

const load = (k, d) => {
  try { return localStorage.getItem(k) ?? d; } catch { return d; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
};

export default function Dashboard({ month, onGo }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [trips, setTrips] = useState(() => load("dash.trips", "include"));
  useEffect(() => {
    setD(null);
    api.dashboard(month, trips).then(setD, (e) => setErr(e.message));
  }, [month, trips]);

  const [yearMode, setYearMode] = useState(() => load("dash.yearMode", "avg"));
  const toggle = (v) => (setTrips(v), save("dash.trips", v));
  const toggleYear = (v) => (setYearMode(v), save("dash.yearMode", v));

  if (err) return <p className="text-critical">{err}</p>;
  if (!d) return <p className="text-muted">טוען…</p>;

  // Year view: show everything as a monthly average by default (divided by months that have data)
  const isYear = d.period === "year";
  const avg = isYear && yearMode === "avg";
  const n = avg ? Math.max(d.monthsInPeriod, 1) : 1;
  const k = {
    ...d.kpis,
    total: d.kpis.total / n, fixed: d.kpis.fixed / n, variable: d.kpis.variable / n,
    byCard: d.kpis.byCard.map((c) => ({ ...c, total: c.total / n })),
  };
  const byCategory = d.byCategory.map((c) => ({
    ...c, total: c.total / n, prev: c.prev / n, subs: c.subs.map((s) => ({ ...s, total: s.total / n })),
  }));
  const hasCompare = !isYear && d.byCategory.some((c) => c.prev);
  const delta = !isYear && d.kpis.prevTotal ? d.kpis.total / d.kpis.prevTotal - 1 : null;
  const unit = avg ? " לחודש" : "";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">{monthLabel(month)}</h2>
        <div className="flex rounded-lg border border-grid bg-surface p-0.5 text-sm" role="radiogroup" aria-label="טיולים">
          {[["include", "כולל טיולים"], ["exclude", "בלי טיולים"]].map(([v, l]) => (
            <button key={v} role="radio" aria-checked={trips === v} onClick={() => toggle(v)}
              className={`rounded-md px-3 py-1 ${trips === v ? "bg-ink text-surface" : "text-ink-2"}`}>{l}</button>
          ))}
        </div>
        {isYear && (
          <div className="flex rounded-lg border border-grid bg-surface p-0.5 text-sm" role="radiogroup" aria-label="תצוגה שנתית">
            {[["avg", "ממוצע לחודש"], ["total", "סה״כ שנתי"]].map(([v, l]) => (
              <button key={v} role="radio" aria-checked={yearMode === v} onClick={() => toggleYear(v)}
                className={`rounded-md px-3 py-1 ${yearMode === v ? "bg-ink text-surface" : "text-ink-2"}`}>{l}</button>
            ))}
          </div>
        )}
        {k.needsReview > 0 && (
          <button onClick={() => onGo("review")} className="ms-auto flex items-center gap-2 text-sm text-ink-2 hover:text-ink">
            <span className="num rounded-full bg-series-2 px-2 py-0.5 text-white">{k.needsReview}</span> מחכות לאישור
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={avg ? "ממוצע לחודש" : "סה״כ"} value={ils(k.total)}
          sub={avg ? <span className="text-muted">{d.monthsInPeriod} חודשים עם נתונים · סה״כ {ils(d.kpis.total)}</span> : delta != null && (
            <span className={delta > 0 ? "text-warn" : "text-good"}>
              {delta > 0 ? "▲" : "▼"} <span className="num">{Math.abs(Math.round(delta * 100))}%</span> מ{monthLabel(d.prevMonth).split(" ")[0]}
            </span>
          )} />
        <Stat label={"הוצאות קבועות" + unit} value={ils(k.fixed)} sub={<span className="text-muted">משתנות: {ils(k.variable)}</span>} />
        {k.byCard.map((c) => (
          <Stat key={c.card} label={`כרטיס ${c.owner}${unit}`} value={ils(c.total)}
            sub={<span className="num text-muted">{k.total ? Math.round((c.total / k.total) * 100) : 0}%</span>} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card p-4 lg:col-span-3">
          <h3 className="font-semibold">לפי קטגוריה{avg ? ", ממוצע לחודש" : ""}</h3>
          <p className="mb-3 flex flex-wrap gap-x-4 text-xs text-muted">
            {hasCompare && <span>הפס הצבעוני: {monthLabel(month)}</span>}
            {hasCompare && <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-4 rounded-sm bg-axis" />{monthLabel(d.prevMonth)}</span>}
            <span>לחיצה על קטגוריה מציגה תתי־קטגוריות</span>
          </p>
          <CategoryBars rows={byCategory} compareKey={hasCompare ? "prev" : undefined} compareLabel={monthLabel(d.prevMonth)}
            total={isYear ? k.total : undefined} />
        </section>
        <div className="grid gap-4 lg:col-span-2">
          <section className="card p-4">
            <h3 className="mb-3 font-semibold">התפלגות</h3>
            <Donut rows={byCategory} />
          </section>
          {d.insights.length > 0 && (
            <section className="card p-4">
              <h3 className="mb-3 font-semibold">תובנות</h3>
              <ul className="grid gap-2 text-sm">
                {d.insights.map((i, n) => (
                  <li key={n} className="flex gap-2">
                    <span aria-hidden className={i.tone === "warn" ? "text-warn" : i.tone === "good" ? "text-good" : "text-series-1"}>
                      {i.tone === "warn" ? "▲" : i.tone === "good" ? "▼" : "●"}
                    </span>
                    <span>{i.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <section className="card p-4">
        <h3 className="font-semibold">{d.period === "year" ? "לפי חודש" : "12 חודשים"}</h3>
        <p className="mb-1 flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-series-1" />שוטף</span>
          {trips === "include" && <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-series-2" />טיולים</span>}
          <span>לחיצה על חודש פותחת אותו</span>
        </p>
        <ColumnChart
          data={d.trend.map((t) => ({ ...t, regular: t.total - t.trip }))}
          series={[{ key: "regular", color: "var(--color-series-1)" }, { key: "trip", color: "var(--color-series-2)" }]}
          labelOf={(t) => monthLabel(t.month, true)}
          highlight={(t) => t.month === month}
          onPick={(t) => onGo("dashboard", t.month)}
          refLine={isYear && d.trend.length > 1 ? { value: d.trend.reduce((x, t) => x + t.total, 0) / d.trend.length, label: `ממוצע ${ils(d.trend.reduce((x, t) => x + t.total, 0) / d.trend.length)}` } : undefined}
          tipOf={(t) => (
            <>
              <div className="font-medium">{monthLabel(t.month)}</div>
              <div className="text-ink-2"><span className="num">{ils(t.total)}</span>
                {t.trip > 0 && <> · טיולים <span className="num">{ils(t.trip)}</span></>}</div>
            </>
          )}
        />
      </section>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ListCard title="איפה הכי הרבה כסף" rows={d.topMerchants.map((m) => ({
          key: m.merchant, main: m.merchant, sub: `${m.count} עסקאות · ${m.category ?? "לא מסווג"}`, value: m.total }))} />
        <ListCard title="העסקאות הגדולות" rows={d.largest.map((t) => ({ key: t.id, main: t.note || t.merchant, sub: txLabel(t), value: t.amount }))} />
        <ListCard title="קבועות החודש" empty="אין הוצאות שסומנו כקבועות"
          rows={d.subscriptions.map((s) => ({ key: s.merchant, main: s.merchant, sub: s.category, value: s.total }))} />
      </div>

      <section className="card p-4">
        <h3 className="font-semibold">לפי יום בשבוע</h3>
        <p className="text-xs text-muted">הוצאות משתנות בלבד, בלי טיולים</p>
        <ColumnChart height={110}
          data={d.weekday.map((v, i) => ({ v, i }))}
          series={[{ key: "v", color: "var(--color-series-1)" }]}
          labelOf={(x) => ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"][x.i]}
          tipOf={(x) => <span className="text-ink-2">יום {["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"][x.i]}: <span className="num">{ils(x.v)}</span></span>}
        />
      </section>
    </div>
  );
}
