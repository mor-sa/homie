import { useState } from "react";
import { ils, dateLabel } from "../api.js";

export const UNCAT_COLOR = "#c3c2b7";
// pastel fills from the sheet need an edge to stay visible on a light surface
const edge = { boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.12)" };

export function Swatch({ color, size = 10 }) {
  return <span className="inline-block shrink-0 rounded-[3px]" style={{ width: size, height: size, background: color ?? UNCAT_COLOR, ...edge }} />;
}

/**
 * Horizontal bars, one per category, in the category's own color. Optional comparison
 * (`compareKey`) draws a thin gray bar under each for e.g. the previous month.
 * Clicking a category with sub-categories expands them.
 */
// onPick(category, sub?) opens the matching transactions; "לא מסווג" is passed as "__none"
const pickKey = (c) => (c === "לא מסווג" ? "__none" : c);

export function CategoryBars({ rows, compareKey, compareLabel, total, onPick }) {
  const [open, setOpen] = useState(null);
  const max = Math.max(...rows.map((r) => Math.max(r.total, compareKey ? r[compareKey] : 0)), 1);
  return (
    <ul className="grid gap-1">
      {rows.map((r) => {
        const cmp = compareKey ? r[compareKey] : null;
        const diff = cmp ? r.total / cmp - 1 : null;
        const expandable = r.subs?.length > 0;
        return (
          <li key={r.category} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => (expandable ? setOpen(open === r.category ? null : r.category) : onPick?.(pickKey(r.category)))}
              className={`group grid w-full grid-cols-[7.5rem_1fr_6rem] items-center gap-2 rounded-md px-1 py-1 text-start text-sm ${expandable || onPick ? "hover:bg-grid/40" : "cursor-default"}`}
              title={`${r.category}: ${ils(r.total)}${cmp != null ? ` · ${compareLabel}: ${ils(cmp)}` : ""}`}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                <Swatch color={r.color} />
                <span className="truncate">{r.category}</span>
                {expandable && <span className="text-[10px] text-muted">{open === r.category ? "▾" : "◂"}</span>}
              </span>
              <span className="grid gap-[3px]">
                <span className="h-4 rounded-l-[4px]" style={{ width: `${Math.max((r.total / max) * 100, r.total > 0 ? 0.8 : 0)}%`, background: r.color ?? UNCAT_COLOR, ...edge }} />
                {cmp != null && <span className="h-1.5 rounded-l-[3px] bg-axis" style={{ width: `${(cmp / max) * 100}%` }} />}
              </span>
              <span className="num text-end leading-tight">
                {ils(r.total)}
                {total ? <span className="block text-[11px] text-muted">{Math.round((r.total / total) * 100)}%</span> : null}
                {diff != null && Math.abs(diff) >= 0.2 && Math.abs(r.total - cmp) > 100 && (
                  <span className={`block text-[11px] ${diff > 0 ? "text-warn" : "text-good"}`}>
                    {diff > 0 ? "+" : "−"}{Math.abs(Math.round(diff * 100))}%
                  </span>
                )}
              </span>
            </button>
            {open === r.category && (
              <ul className="mb-1 ms-6 grid gap-0.5 border-s border-grid ps-3">
                {r.subs.map((s) => (
                  <li key={s.name} onClick={() => onPick?.(r.category, s.name)}
                    className={`grid grid-cols-[7rem_1fr_5.5rem] items-center gap-2 rounded px-1 py-0.5 text-xs ${onPick ? "cursor-pointer hover:bg-grid/40" : ""}`}>
                    <span className="truncate text-ink-2">{s.name}</span>
                    <span className="h-2.5 rounded-l-[3px] opacity-80" style={{ width: `${(s.total / max) * 100}%`, background: r.color ?? UNCAT_COLOR, ...edge }} />
                    <span className="num text-end">{ils(s.total)}</span>
                  </li>
                ))}
                {r.total - r.subs.reduce((a, s) => a + s.total, 0) > 1 && (
                  <li onClick={() => onPick?.(r.category, "__none")}
                    className={`grid grid-cols-[7rem_1fr_5.5rem] gap-2 rounded px-1 py-0.5 text-xs text-muted ${onPick ? "cursor-pointer hover:bg-grid/40" : ""}`}>
                    <span>ללא תת־קטגוריה</span><span />
                    <span className="num text-end">{ils(r.total - r.subs.reduce((a, s) => a + s.total, 0))}</span>
                  </li>
                )}
              </ul>
            )}
            </div>
            {onPick && (
              <button type="button" onClick={() => onPick(pickKey(r.category))} title={`עסקאות ב${r.category}`}
                aria-label={`עסקאות ב${r.category}`} className="self-start rounded-md px-1.5 py-1 text-sm text-muted hover:bg-grid/40 hover:text-ink">↗</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Donut in category colors, like the pie in the original sheet. Small slices fold into "אחר". */
export function Donut({ rows, size = 180, onPick }) {
  const [hover, setHover] = useState(null);
  const positive = rows.filter((r) => r.total > 0);
  const total = positive.reduce((a, r) => a + r.total, 0);
  if (!total) return <p className="text-sm text-muted">אין נתונים</p>;
  const main = positive.filter((r) => r.total / total >= 0.025);
  const rest = positive.filter((r) => r.total / total < 0.025);
  const slices = rest.length ? [...main, { category: "אחר", color: "#e1e0d9", total: rest.reduce((a, r) => a + r.total, 0) }] : main;

  const R = 50, r = 32, C = 60;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const a = (s.total / total) * Math.PI * 2;
    const [x0, y0, x1, y1] = [C + R * Math.cos(angle), C + R * Math.sin(angle), C + R * Math.cos(angle + a), C + R * Math.sin(angle + a)];
    const [x2, y2, x3, y3] = [C + r * Math.cos(angle + a), C + r * Math.sin(angle + a), C + r * Math.cos(angle), C + r * Math.sin(angle)];
    const large = a > Math.PI ? 1 : 0;
    const d = slices.length === 1
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`
      : `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    angle += a;
    return { ...s, d };
  });
  const h = hover && slices.find((s) => s.category === hover);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} onMouseLeave={() => setHover(null)}>
        {arcs.map((s) => (
          <path key={s.category} d={s.d} fill={s.color ?? UNCAT_COLOR} stroke="var(--color-surface)" strokeWidth="1"
            opacity={hover && hover !== s.category ? 0.45 : 1} onMouseEnter={() => setHover(s.category)}
            onClick={() => onPick && s.category !== "אחר" && onPick(pickKey(s.category))} style={{ cursor: onPick && s.category !== "אחר" ? "pointer" : undefined }}>
            <title>{`${s.category}: ${ils(s.total)} (${Math.round((s.total / total) * 100)}%)`}</title>
          </path>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="max-w-[5.5rem] truncate text-[11px] text-ink-2">{h ? h.category : "סה״כ"}</span>
        <span className="num text-sm font-semibold">{ils(h ? h.total : total)}</span>
        {h && <span className="num text-[11px] text-muted">{Math.round((h.total / total) * 100)}%</span>}
      </div>
    </div>
  );
}

/** Vertical bars over time; `series` = [{key, color, label}], stacked bottom-up. */
export function ColumnChart({ data, labelOf, series, highlight, onPick, height = 160, tipOf, refLine }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...data.map((d) => series.reduce((a, s) => a + Math.max(d[s.key] ?? 0, 0), 0)), refLine?.value ?? 0, 1);
  const h = hover ?? (highlight ? data.find(highlight) : null);
  return (
    <div>
      <div className="mb-2 h-10 text-sm">{h && tipOf(h)}</div>
      <div className="relative flex items-end gap-1 border-b border-axis" style={{ height }} onMouseLeave={() => setHover(null)}>
        {refLine && (
          <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-ink/60" style={{ bottom: `${(refLine.value / max) * 100}%` }}>
            <span className="absolute -top-5 left-0 rounded bg-surface px-1 text-[11px] text-ink-2">{refLine.label}</span>
          </div>
        )}
        {data.map((d, i) => (
          <button key={i} type="button" onMouseEnter={() => setHover(d)} onFocus={() => setHover(d)} onClick={() => onPick?.(d)}
            className={`flex h-full min-w-0 flex-1 flex-col-reverse justify-start gap-[2px] rounded-t px-px ${onPick ? "hover:bg-grid/40" : "cursor-default"}`}>
            {series.map((s, j) => {
              const v = Math.max(d[s.key] ?? 0, 0);
              if (!v) return null;
              const top = series.slice(j + 1).every((t) => !(d[t.key] > 0));
              return <span key={s.key} className={`w-full ${top ? "rounded-t-[4px]" : ""}`}
                style={{ height: `${(v / max) * 100}%`, background: s.color, opacity: highlight && !highlight(d) ? 0.55 : 1 }} />;
            })}
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-muted">
        {data.map((d, i) => (
          <span key={i} className={`min-w-0 flex-1 truncate text-center ${highlight?.(d) ? "font-semibold text-ink" : ""}`}>{labelOf(d, i)}</span>
        ))}
      </div>
    </div>
  );
}

export function ListCard({ title, rows, empty = "אין נתונים" }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-2.5">
          {rows.map((r) => (
            <li key={r.key} onClick={r.onClick}
              className={`flex items-baseline justify-between gap-3 rounded text-sm ${r.onClick ? "-mx-1 cursor-pointer px-1 hover:bg-grid/40" : ""}`}>
              <span className="min-w-0">
                <span className="block truncate">{r.main}</span>
                <span className="block truncate text-xs text-muted">{r.sub}</span>
              </span>
              <span className="num shrink-0 font-medium">{ils(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Stat({ label, value, sub, onClick }) {
  return (
    <div onClick={onClick} className={`card p-4 ${onClick ? "cursor-pointer hover:border-axis" : ""}`}>
      <div className="text-sm text-ink-2">{label}</div>
      <div className="num mt-1 text-2xl font-bold" style={{ textAlign: "right" }}>{value}</div>
      {sub && <div className="mt-1 text-xs">{sub}</div>}
    </div>
  );
}

export const txLabel = (t) => `${dateLabel(t.purchase_date)} · ${t.category ?? "לא מסווג"}${t.subcategory ? " › " + t.subcategory : ""}`;

export function Segmented({ label, value, options, onChange }) {
  return (
    <div className="flex rounded-lg border border-grid bg-surface p-0.5 text-sm" role="radiogroup" aria-label={label}>
      {options.map(([v, l, disabled]) => (
        <button key={v} role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 disabled:opacity-40 ${value === v ? "bg-ink text-surface" : "text-ink-2"}`}>{l}</button>
      ))}
    </div>
  );
}
