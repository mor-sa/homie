import { createContext, useContext, useEffect, useState } from "react";
import { api, ils, monthLabel } from "../api.js";
import { ColumnChart, Donut, HideButton, Segmented, Swatch, subLabel } from "../components/charts.jsx";
import { useHidden } from "../hidden.js";

const load = (k, d) => {
  try { return localStorage.getItem(k) ?? d; } catch { return d; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
};
// "סה״כ" or "ממוצע לחודש" in the middle of every pie
const PieLabel = createContext("סה״כ");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const CAT_SLOTS = [1, 3, 4, 5, 7, 8, 6].map((i) => `var(--color-series-${i})`);
const TRIP_SLOTS = [2, 3, 7, 4, 5, 8, 6].map((i) => `var(--color-series-${i})`);
const REST = "var(--color-axis)";
const BREAKDOWNS = [["type", "שוטף / טיולים"], ["fixed", "קבועות / משתנות"], ["card", "כרטיס"], ["trip", "טיול"], ["category", "קטגוריה"]];

// Stacked series for the monthly chart, per breakdown. Colors follow the entity (card order, trip order,
// the category's own color), never the rank, and anything past the palette folds into one gray "other".
function trendSeries(d, by, owners) {
  const rows = d.trend;
  if (by === "card") {
    const cards = [...new Set(rows.flatMap((t) => Object.keys(t.cards)))].sort();
    return {
      series: cards.map((c, i) => ({ key: "c" + c, label: owners[c] ?? c, color: CAT_SLOTS[i % CAT_SLOTS.length] })),
      data: rows.map((t) => ({ ...t, ...Object.fromEntries(cards.map((c) => ["c" + c, t.cards[c] ?? 0])) })),
    };
  }
  if (by === "trip") {
    const shown = d.trendTrips.slice(-TRIP_SLOTS.length);
    const folded = d.trendTrips.slice(0, -TRIP_SLOTS.length);
    return {
      series: [
        { key: "regular", label: "שוטף", color: REST },
        ...(folded.length ? [{ key: "tOther", label: "טיולים קודמים", color: "var(--color-muted)" }] : []),
        ...shown.map((t, i) => ({ key: "t" + t.id, label: t.name, color: TRIP_SLOTS[i] })),
      ],
      data: rows.map((t) => ({
        ...t, regular: t.total - t.trip,
        tOther: folded.reduce((a, x) => a + (t.trips[x.id] ?? 0), 0),
        ...Object.fromEntries(shown.map((x) => ["t" + x.id, t.trips[x.id] ?? 0])),
      })),
    };
  }
  if (by === "category") {
    const colors = Object.fromEntries(d.byCategory.map((c) => [c.category, c.color]));
    const totals = {};
    rows.forEach((t) => Object.entries(t.cats).forEach(([c, v]) => (totals[c] = (totals[c] ?? 0) + v)));
    const ranked = Object.keys(totals).filter((c) => totals[c] > 0).sort((a, b) => totals[b] - totals[a]);
    const top = ranked.slice(0, 9);
    const rest = ranked.slice(9);
    return {
      series: [
        ...top.map((c) => ({ key: "k" + c, label: c, color: colors[c] ?? REST })),
        ...(rest.length ? [{ key: "kOther", label: "שאר הקטגוריות", color: REST }] : []),
      ],
      data: rows.map((t) => ({
        ...t, kOther: rest.reduce((a, c) => a + (t.cats[c] ?? 0), 0),
        ...Object.fromEntries(top.map((c) => ["k" + c, t.cats[c] ?? 0])),
      })),
    };
  }
  if (by === "fixed") {
    return {
      series: [
        { key: "fixed", label: "קבועות", color: "var(--color-series-7)" },
        { key: "variable", label: "משתנות", color: "var(--color-series-1)" },
      ],
      data: rows.map((t) => ({ ...t, variable: t.total - t.fixed })),
    };
  }
  return {
    series: [
      { key: "regular", label: "שוטף", color: "var(--color-series-1)" },
      ...(d.excludeTrips ? [] : [{ key: "trip", label: "טיולים", color: "var(--color-series-2)" }]),
    ],
    data: rows.map((t) => ({ ...t, regular: t.total - t.trip })),
  };
}


export default function Graphs({ period, onGo, onDrill }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [trips, setTrips] = useState(() => load("dash.trips", "include"));
  const [card, setCard] = useState(() => load("dash.card", ""));
  const [by, setBy] = useState(() => load("graphs.by", "category"));
  const [yearMode, setYearMode] = useState(() => load("dash.yearMode", "avg"));
  const [tripMeasure, setTripMeasure] = useState(() => load("graphs.tripMeasure", "total"));
  const { hidden, hide, show, showAll } = useHidden();
  const hiddenKey = hidden.join(",");
  useEffect(() => {
    setD(null);
    api.dashboard(period, trips, card, hidden).then(setD, (e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, trips, card, hiddenKey]);

  if (err) return <p className="text-critical">{err}</p>;
  if (!d) return <p className="text-muted">טוען…</p>;

  const isYear = d.period === "year";
  // Year view as a monthly average: every amount divided by the months that have data (shares don't change)
  const avg = isYear && yearMode === "avg";
  const n = avg ? Math.max(d.monthsInPeriod, 1) : 1;
  const div = (x) => x / n;
  const scaleCats = (list) => list.map((c) => ({ ...c, total: div(c.total), subs: c.subs.map((s) => ({ ...s, total: div(s.total) })) }));
  const ds = avg ? {
    ...d,
    kpis: { ...d.kpis, total: div(d.kpis.total), fixed: div(d.kpis.fixed), variable: div(d.kpis.variable), trip: div(d.kpis.trip),
      byCard: d.kpis.byCard.map((c) => ({ ...c, total: div(c.total) })) },
    byCategory: scaleCats(d.byCategory),
    byCategoryNoTrips: scaleCats(d.byCategoryNoTrips),
    tripsInPeriod: d.tripsInPeriod.map((t) => ({ ...t, total: div(t.total) })),
    weekday: d.weekday.map(div),
    hidden: d.hidden.map((h) => ({ ...h, total: div(h.total) })),
  } : d;
  const monthAvg = d.trend.length ? d.trend.reduce((x, t) => x + t.total, 0) / d.trend.length : 0;
  const owners = Object.fromEntries(d.cards.map((c) => [c.last4, c.owner]));
  const cardColor = Object.fromEntries([...d.cards].sort((a, b) => a.last4.localeCompare(b.last4)).map((c, i) => [c.last4, CAT_SLOTS[i % CAT_SLOTS.length]]));
  const breakdown = by === "trip" && trips === "exclude" ? "type" : by;
  const chart = trendSeries(d, breakdown, owners);
  const base = { ...(trips === "exclude" ? { notrips: "1" } : {}), ...(card ? { card } : {}) };
  const drill = (f, p = period) => onDrill({ ...base, ...f }, p);
  const set = (fn, key) => (v) => (fn(v), save(key, v));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">גרפים · {monthLabel(period)}</h2>
        <Segmented label="טיולים" value={trips} onChange={set(setTrips, "dash.trips")} options={[["include", "כולל טיולים"], ["exclude", "בלי טיולים"]]} />
        {d.cards.length > 1 && (
          <Segmented label="כרטיס" value={card} onChange={set(setCard, "dash.card")}
            options={[["", "כל הכרטיסים"], ...d.cards.map((c) => [c.last4, c.owner === c.last4 ? `כרטיס ${c.last4}` : c.owner])]} />
        )}
        {isYear && (
          <Segmented label="תצוגה שנתית" value={yearMode} onChange={set(setYearMode, "dash.yearMode")}
            options={[["avg", "ממוצע לחודש"], ["total", "סה״כ שנתי"]]} />
        )}
        {avg && <span className="text-xs text-muted">הסכומים בעוגות מחולקים ב־{d.monthsInPeriod} חודשים עם נתונים</span>}
      </div>

      {d.hidden.length > 0 && (
        <p className="-mt-2 text-xs text-muted">
          {d.hidden.length === 1
            ? `${d.hidden[0].sub ? `${d.hidden[0].category} › ${subLabel(d.hidden[0].sub)}` : d.hidden[0].category} מוסתרת מהגרפים ומהסכומים (מופיעה באפור)`
            : `מוסתרות מהגרפים ומהסכומים (מופיעות באפור): ${d.hidden.map((h) => (h.sub ? `${h.category} › ${subLabel(h.sub)}` : h.category)).join(", ")}`}
          {" · "}<button onClick={showAll} className="text-series-1 hover:underline">להחזיר הכל</button>
        </p>
      )}

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">הוצאות לפי חודש</h3>
          <Segmented label="פילוח לפי" value={breakdown} onChange={set(setBy, "graphs.by")}
            options={BREAKDOWNS.map(([v, l]) => [v, l, v === "trip" && trips === "exclude"])} />
        </div>
        <Legend series={chart.series} note="לחיצה על חודש פותחת את הסקירה שלו" />
        <ColumnChart height={200}
          data={chart.data}
          series={chart.series}
          labelOf={(t) => monthLabel(t.month, true)}
          onPick={(t) => onGo("dashboard", t.month)}
          refLine={isYear && d.trend.length > 1 ? { value: monthAvg, label: `ממוצע ${ils(monthAvg)}` } : undefined}
          tipOf={(t) => {
            const parts = chart.series.map((s) => [s.label, t[s.key] ?? 0]).filter(([, v]) => Math.abs(v) > 0.5).sort((a, b) => b[1] - a[1]);
            return (
              <>
                <div><span className="font-medium">{monthLabel(t.month)}</span> · <span className="num">{ils(t.total)}</span></div>
                {parts.length > 1 && (
                  <div className="truncate text-xs text-ink-2">
                    {parts.slice(0, 5).map(([l, v], i) => <span key={l}>{i > 0 && " · "}{l} <span className="num">{ils(v)}</span></span>)}
                    {parts.length > 5 && " · …"}
                  </div>
                )}
              </>
            );
          }}
        />
      </section>

      <PieLabel.Provider value={avg ? "ממוצע לחודש" : "סה״כ"}>
        <Pies d={ds} onHide={hide} onShow={show} owners={owners} cardColor={cardColor} trips={trips} card={card} drill={drill} onGo={onGo} />
      </PieLabel.Provider>

      <Changes d={d} isYear={isYear} onPick={(category) => drill({ category })} />

      <CategoryMultiples d={d} onHide={hide} onShow={show} onPick={(category, month) => drill({ category }, month)} />

      <div className="grid gap-4 lg:grid-cols-2">
        {!card && d.cards.length > 1 && <WhoPays d={d} owners={owners} cardColor={cardColor} onPick={(category, c) => drill({ category, card: c })} />}
        {d.tripsCompare.length > 0 && (
          <TripsCompare trips={d.tripsCompare} measure={tripMeasure} onMeasure={set(setTripMeasure, "graphs.tripMeasure")}
            onPick={(id) => onGo("trips", String(id))} />
        )}
      </div>
    </div>
  );
}

// A pie with its legend: label, amount and share. Clicking a slice or a legend row runs that row's action.
function PieCard({ title, note, rows, extra, size = 150 }) {
  const centerLabel = useContext(PieLabel);
  const shown = rows.filter((r) => !r.hidden);
  const total = shown.reduce((a, r) => a + Math.max(r.total, 0), 0);
  const byLabel = Object.fromEntries(shown.map((r) => [r.category, r]));
  return (
    <section className="card p-4">
      <h3 className="font-semibold">{title}</h3>
      {note && <p className="text-xs text-muted">{note}</p>}
      {extra}
      <div className="mt-3"><Donut rows={shown} size={size} centerLabel={centerLabel} onPick={(label) => byLabel[label === "__none" ? "לא מסווג" : label]?.onPick?.()} /></div>
      <ul className={`mt-3 grid gap-x-4 gap-y-1 text-sm ${rows.length > 8 ? "sm:grid-cols-2" : ""}`}>
        {rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total).map((r) => r.hidden ? (
          <li key={r.category} className="flex items-center text-muted" title={`${r.category} מוסתרת`}>
            <span className="flex min-w-0 flex-1 items-center gap-2 px-1">
              <span className="opacity-40"><Swatch color={r.color} /></span>
              <span className="min-w-0 flex-1 truncate line-through decoration-1">{r.category}</span>
              <span className="num">{ils(r.total)}</span><span className="w-9" />
            </span>
            <HideButton off category={r.category} onHide={r.onShow} className="py-0" />
          </li>
        ) : (
          <li key={r.category} className="flex items-center">
            <button onClick={r.onPick} disabled={!r.onPick} className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 text-start enabled:hover:bg-grid/40">
              <Swatch color={r.color} /><span className="min-w-0 flex-1 truncate">{r.category}</span>
              <span className="num text-ink-2">{ils(r.total)}</span>
              <span className="num w-9 text-end text-xs text-muted">{pct(r.total, total)}%</span>
            </button>
            {r.onHide && <HideButton category={r.category} onHide={r.onHide} className="py-0" />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Pies({ d, onHide, onShow, owners, cardColor, trips, card, drill, onGo }) {
  const k = d.kpis;
  const [subCat, setSubCat] = useState(() => load("graphs.subCat", ""));
  const withSubs = d.byCategory.filter((c) => (c.subs.length > 0 && c.total > 0) || d.hidden.some((h) => h.sub && h.category === c.category));
  const cat = withSubs.find((c) => c.category === subCat) ?? withSubs[0];
  const weekend = d.weekday[5] + d.weekday[6];
  const weekdays = d.weekday.slice(0, 5).reduce((a, v) => a + v, 0);

  const pies = [];
  if (!card && k.byCard.length > 1) pies.push(
    <PieCard key="card" title="לפי כרטיס" rows={k.byCard.map((c) => ({
      category: owners[c.card] ?? c.card, color: cardColor[c.card], total: c.total, onPick: () => drill({ card: c.card }) }))} />);
  pies.push(
    <PieCard key="fixed" title="קבועות מול משתנות" rows={[
      { category: "קבועות", color: "var(--color-series-7)", total: k.fixed, onPick: () => drill({ fixed: "1" }) },
      { category: "משתנות", color: "var(--color-series-1)", total: k.variable },
    ]} />);
  if (trips === "include" && k.trip > 0) pies.push(
    <PieCard key="trip" title="שוטף מול טיולים" rows={[
      { category: "שוטף", color: "var(--color-series-1)", total: k.total - k.trip, onPick: () => drill({ notrips: "1" }) },
      { category: "טיולים", color: "var(--color-series-2)", total: k.trip },
    ]} />);
  if (trips === "include" && d.tripsInPeriod.length > 1) {
    const order = d.trendTrips.map((t) => t.id);
    pies.push(
      <PieCard key="trips" title="בין הטיולים" note="ההוצאות שנרשמו בתקופה הזו" rows={d.tripsInPeriod.map((t) => ({
        category: t.name, total: t.total, color: TRIP_SLOTS[Math.max(order.indexOf(t.id), 0) % TRIP_SLOTS.length],
        onPick: () => onGo("trips", String(t.id)) }))} />);
  }
  if (weekend + weekdays > 0) pies.push(
    <PieCard key="weekend" title="סוף שבוע מול אמצע שבוע" note="משתנות בלבד, בלי טיולים. שישי ושבת מול ראשון עד חמישי" rows={[
      { category: "ראשון–חמישי", color: "var(--color-series-1)", total: weekdays },
      { category: "שישי–שבת", color: "var(--color-series-4)", total: weekend },
    ]} />);

  if (cat) pies.push(
    <SubPie key="subs" cat={cat} drill={drill} onHide={onHide} onShow={onShow}
      hiddenSubs={d.hidden.filter((h) => h.sub && h.category === cat.category)} extra={
      <select value={cat.category} onChange={(e) => (setSubCat(e.target.value), save("graphs.subCat", e.target.value))}
        aria-label="קטגוריה" className="mt-2 rounded-lg border border-grid bg-surface px-2 py-1 text-sm">
        {withSubs.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
      </select>
    } />);

  // the two big category pies: trips folded into one slice, and every expense in its own category
  const catRows = (list) => [
    ...list.filter((c) => c.total > 0).map((c) => ({
      category: c.category, color: c.color, total: c.total, onHide,
      onPick: () => drill({ category: c.category === "לא מסווג" ? "__none" : c.category, ...(list === d.byCategoryNoTrips ? { notrips: "1" } : {}) }),
    })),
    ...d.hidden.filter((h) => !h.sub).map((h) => ({ ...h, hidden: true, onShow })),
  ];
  const foldTrips = trips === "include" && k.trip > 0;

  return (
    <div className="grid gap-4">
      <div className={`grid gap-4 ${foldTrips ? "md:grid-cols-2" : ""}`}>
        {foldTrips && (
          <PieCard size={220} title="קטגוריות, הטיולים כפרוסה אחת" note="כל ההוצאות בטיולים מאוגדות יחד"
            rows={[...catRows(d.byCategoryNoTrips), { category: "טיולים", color: "var(--color-series-2)", total: k.trip, onPick: () => onGo("trips") }]
              .sort((a, b) => b.total - a.total)} />
        )}
        <PieCard size={220} title="לפי קטגוריות" note={foldTrips ? "גם הוצאות הטיולים מחולקות לקטגוריות שלהן" : undefined}
          rows={catRows(d.byCategory)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{pies}</div>
    </div>
  );
}

// Sub-categories as shades of the category's own color (one hue, light to dark by size)
function SubPie({ cat, drill, extra, onHide, onShow, hiddenSubs = [] }) {
  const unsplit = cat.total - cat.subs.reduce((a, s) => a + s.total, 0);
  const subs = cat.subs.filter((s) => s.total > 0);
  // biggest slice in the category's own color, the rest stepping darker (toward a fixed dark, so pastels work in both modes)
  const shade = (i) => {
    const t = Math.round((i * 70) / Math.max(subs.length - 1, 1));
    return `color-mix(in oklab, ${cat.color ?? "#c3c2b7"} ${100 - t}%, #1f2a24 ${t}%)`;
  };
  const rows = [
    ...subs.map((s, i) => ({ category: s.name, color: shade(i), total: s.total, onPick: () => drill({ category: cat.category, sub: s.name }),
      onHide: () => onHide(cat.category, s.name) })),
    ...(unsplit > 0.5 ? [{ category: subLabel("__none"), color: "var(--color-grid)", total: unsplit, onPick: () => drill({ category: cat.category, sub: "__none" }),
      onHide: () => onHide(cat.category, "__none") }] : []),
    ...hiddenSubs.map((h) => ({ category: subLabel(h.sub), color: cat.color, total: h.total, hidden: true, onShow: () => onShow(cat.category, h.sub) })),
  ];
  return <PieCard title="קטגוריה לפי תתי־קטגוריות" note={`${cat.category}: ${ils(cat.total)}`} rows={rows} extra={extra} />;
}

function Legend({ series, note }) {
  return (
    <p className="mb-1 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
        </span>
      ))}
      {note && <span>· {note}</span>}
    </p>
  );
}

// What changed: each category against a comparison period, as a diverging bar around zero.
// Month: vs the average of the 3 months before. Year: monthly average vs last year's, when last year has
// at least 6 months of data; otherwise the year's last 3 months vs its earlier months.
function Changes({ d, isYear, onPick }) {
  const avgOf = (months, cat) => months.reduce((a, t) => a + (t.cats[cat] ?? 0), 0) / Math.max(months.length, 1);
  let caption, nowOf, beforeOf;
  if (!isYear) {
    caption = `${monthLabel(d.month)} מול הממוצע של 3 החודשים שלפניו`;
    nowOf = (c) => c.total;
    beforeOf = (c) => c.avg3;
  } else if (d.prevMonthsInPeriod >= 6) {
    caption = `ממוצע חודשי ב־${d.month} מול ממוצע חודשי ב־${d.prevMonth}`;
    nowOf = (c) => c.total / Math.max(d.monthsInPeriod, 1);
    beforeOf = (c) => c.prev / d.prevMonthsInPeriod;
  } else if (d.trend.length >= 6) {
    const recent = d.trend.slice(-3);
    const earlier = d.trend.slice(0, -3);
    caption = `3 החודשים האחרונים (${monthLabel(recent[0].month, true)}–${monthLabel(recent[2].month, true)}) מול ממוצע ${earlier.length} החודשים שלפניהם`;
    nowOf = (c) => avgOf(recent, c.category);
    beforeOf = (c) => avgOf(earlier, c.category);
  } else return null;
  const rows = d.byCategory
    .filter((c) => c.category !== "לא מסווג")
    .map((c) => ({ category: c.category, color: c.color, now: nowOf(c), before: beforeOf(c), delta: nowOf(c) - beforeOf(c) }))
    .filter((r) => Math.abs(r.delta) >= 50)
    .sort((a, b) => b.delta - a.delta);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.delta)), 1);
  return (
    <section className="card p-4">
      <h3 className="font-semibold">מה השתנה</h3>
      <p className="mb-3 text-xs text-muted">
        {caption}
        {" · "}<span className="text-series-2">▲ יותר</span> · <span className="text-series-1">▼ פחות</span>
      </p>
      <ul className="grid gap-1.5">
        {rows.map((r) => (
          <li key={r.category}>
            <button onClick={() => onPick(r.category)} className="grid w-full grid-cols-[7rem_1fr_1fr_6.5rem] items-center gap-2 rounded px-1 text-sm hover:bg-grid/40"
              title={`${ils(r.before)} ← ${ils(r.now)}`}>
              <span className="flex items-center gap-1.5 truncate text-start"><Swatch color={r.color} />{r.category}</span>
              {/* RTL grid: column 2 sits right of the zero line ("more"), column 3 left of it ("less");
                  both bars are anchored at the zero line between them */}
              <span className="flex h-3 justify-end">
                {r.delta > 0 && <span className="h-full rounded-s-[4px] bg-series-2" style={{ width: `${(r.delta / max) * 100}%` }} />}
              </span>
              <span className="flex h-3 justify-start border-s border-axis">
                {r.delta < 0 && <span className="h-full rounded-e-[4px] bg-series-1" style={{ width: `${(-r.delta / max) * 100}%` }} />}
              </span>
              <span className="num text-end text-xs text-ink-2">
                {r.delta > 0 ? "▲" : "▼"} {ils(Math.abs(r.delta))}{r.before > 0 ? ` (${Math.round((r.delta / r.before) * 100)}%)` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Small multiples: one mini column chart per category, all on the same scale so heights compare honestly
function CategoryMultiples({ d, onHide, onShow, onPick }) {
  const [shared, setShared] = useState(() => load("graphs.sharedScale", "own") === "shared");
  const months = d.trend.map((t) => t.month);
  const cats = [...d.byCategory.filter((c) => c.total > 0).slice(0, 12), ...d.hidden.filter((h) => !h.sub).map((h) => ({ ...h, hidden: true }))]
    .sort((a, b) => b.total - a.total);
  const globalMax = Math.max(...cats.filter((c) => !c.hidden).flatMap((c) => months.map((m, i) => d.trend[i].cats[c.category] ?? 0)), 1);
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">כל קטגוריה לאורך זמן</h3>
        <Segmented label="סקאלה" value={shared ? "shared" : "own"} onChange={(v) => (setShared(v === "shared"), save("graphs.sharedScale", v))}
          options={[["own", "סקאלה לכל קטגוריה"], ["shared", "סקאלה משותפת"]]} />
      </div>
      <p className="mb-3 text-xs text-muted">
        {shared ? "כל הגרפים באותה סקאלה: אפשר להשוות גבהים בין קטגוריות" : "כל גרף בסקאלה משלו: רואים את המגמה בתוך הקטגוריה"} · לחיצה על עמודה פותחת את העסקאות
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        {cats.map((c) => {
          if (c.hidden) return (
            <div key={c.category} className="text-muted">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 truncate"><span className="opacity-40"><Swatch color={c.color} /></span><span className="line-through decoration-1">{c.category}</span></span>
                <HideButton off category={c.category} onHide={onShow} className="py-0" />
              </div>
              <div className="flex h-14 items-center justify-center rounded border border-dashed border-axis text-xs">מוסתרת</div>
            </div>
          );
          const vals = months.map((m, i) => d.trend[i].cats[c.category] ?? 0);
          const max = shared ? globalMax : Math.max(...vals, 1);
          const avg = vals.reduce((a, v) => a + v, 0) / Math.max(vals.length, 1);
          return (
            <div key={c.category}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 truncate font-medium"><Swatch color={c.color} />{c.category}</span>
                <span className="flex shrink-0 items-center">
                  <span className="num text-xs text-muted">~{ils(avg)}</span>
                  <HideButton category={c.category} onHide={onHide} className="py-0" />
                </span>
              </div>
              <div className="flex h-14 items-end gap-[2px] border-b border-axis">
                {vals.map((v, i) => (
                  <button key={months[i]} onClick={() => onPick(c.category, months[i])} title={`${monthLabel(months[i])}: ${ils(v)}`}
                    className="flex h-full flex-1 items-end hover:bg-grid/40">
                    <span className="w-full rounded-t-[3px]" style={{ height: `${(Math.max(v, 0) / max) * 100}%`, background: c.color ?? "var(--color-axis)", boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.12)" }} />
                  </button>
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-[10px] text-muted">
                <span>{monthLabel(months[0], true)}</span><span>{monthLabel(months[months.length - 1], true)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Who pays for what: each category as a 100% bar split by card
function WhoPays({ d, owners, cardColor, onPick }) {
  const cards = Object.keys(cardColor);
  return (
    <section className="card p-4">
      <h3 className="font-semibold">מי משלם על מה</h3>
      <Legend series={cards.map((c) => ({ key: c, label: owners[c] ?? c, color: cardColor[c] }))} note="חלוקה לפי כרטיס בכל קטגוריה" />
      <ul className="mt-2 grid gap-2">
        {d.catByCard.slice(0, 12).map((r) => (
          <li key={r.category} className="grid grid-cols-[7rem_1fr] items-center gap-2 text-sm">
            <span className="truncate">{r.category}</span>
            <span className="flex h-4 gap-[2px] overflow-hidden rounded-[4px]">
              {cards.filter((c) => r.cards[c] > 0).map((c) => (
                <button key={c} onClick={() => onPick(r.category, c)} title={`${owners[c] ?? c}: ${ils(r.cards[c])}`}
                  className="flex h-full items-center justify-center text-[10px] font-medium text-white"
                  style={{ width: `${pct(r.cards[c], r.total)}%`, background: cardColor[c] }}>
                  {pct(r.cards[c], r.total) >= 18 && <span className="num">{pct(r.cards[c], r.total)}%</span>}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TripsCompare({ trips, measure, onMeasure, onPick }) {
  const key = measure === "perDay" ? "perDay" : "total";
  const max = Math.max(...trips.map((t) => t[key]), 1);
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">השוואת טיולים</h3>
        <Segmented label="מדד" value={key} onChange={onMeasure} options={[["total", "סה״כ"], ["perDay", "ליום"]]} />
      </div>
      <p className="mb-3 text-xs text-muted">כל ההוצאות שתויגו לטיול, כולל טיסות ומלונות ששולמו מראש</p>
      <ul className="grid gap-2.5">
        {[...trips].reverse().map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t.id)} className="grid w-full gap-1 rounded px-1 text-start text-sm hover:bg-grid/40">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{t.name}</span>
                <span className="num shrink-0">{ils(t[key])}{key === "perDay" ? " ליום" : ""}</span>
              </span>
              <span className="h-2.5 rounded-e-[4px] bg-series-2" style={{ width: `${(t[key] / max) * 100}%` }} />
              <span className="text-xs text-muted">
                {t.days} ימים · {key === "perDay" ? `סה״כ ${ils(t.total)}` : `${ils(t.perDay)} ליום`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
