import { useEffect, useMemo, useState } from "react";
import { api, ils, dateLabel, monthLabel } from "../api.js";
import { Swatch } from "../components/charts.jsx";

const SOURCE = { rule: "לפי עסק", trip: "טיול", ai: "הצעת AI", web: "חיפוש ברשת", manual: "ידני", history: "מהגיליון" };

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export default function Transactions({ meta, month, filters = {}, onFilters, reviewMode = false, onChanged }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState(filters.q ?? "");
  const [toast, setToast] = useState(null);
  const owners = useMemo(() => Object.fromEntries(meta.cards.map((c) => [c.last4, c.owner])), [meta.cards]);
  const setFilter = (patch) => onFilters({ ...filters, ...patch });

  const load = () => api.transactions(reviewMode ? { review: "1" } : { month, ...filters }).then(setRows);
  useEffect(() => {
    load();
  }, [month, reviewMode]);

  const flash = (t) => {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  };

  async function save(row, patch) {
    const r = await api.update(row.id, { ...patch });
    if (r.alsoUpdated) flash(`עודכנו גם ${r.alsoUpdated} עסקאות נוספות של ${row.merchant}`);
    await load();
    onChanged();
  }

  const [searchingAll, setSearchingAll] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  async function aiSuggest() {
    setSuggesting(true);
    try {
      const r = await api.aiSuggest();
      flash(`התקבלו הצעות ל-${r.suggested} מתוך ${r.total} עסקאות. עברו ואשרו.`);
      await load();
    } catch (e) {
      flash(e.message);
    }
    setSuggesting(false);
  }
  async function researchAll() {
    setSearchingAll(true);
    try {
      const r = await api.researchAll();
      flash(`נמצאו הצעות ל-${r.done} עסקים${r.failed ? `, ${r.failed} נכשלו` : ""}. עברו ואשרו.`);
      await load();
    } catch (e) {
      flash(e.message);
    }
    setSearchingAll(false);
  }

  async function approveAll() {
    const ids = rows.filter((r) => r.category).map((r) => r.id);
    const r = await api.approve(ids);
    flash(`אושרו ${r.approved} עסקאות`);
    await load();
    onChanged();
  }

  if (!rows) return <p className="text-muted">טוען…</p>;

  const total = rows.filter((r) => r.status === "posted").reduce((a, r) => a + (r.amount ?? 0), 0);
  const withSuggestion = rows.filter((r) => r.category).length;

  return (
    <div className="grid gap-4">
      {reviewMode ? (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">עסקאות לאישור</h2>
            <p className="text-sm text-ink-2">
              שינוי קטגוריה נשמר מיד ומלמד את המערכת. עסקים כמו BIT תמיד יגיעו לכאן, כי שם העסק לא מספר מה נקנה.
              {!meta.aiEnabled && " (הצעות AI כבויות: לא הוגדר ANTHROPIC_API_KEY)"}
            </p>
          </div>
          {meta.aiEnabled && rows.some((r) => !r.category) && (
            <button onClick={aiSuggest} disabled={suggesting}
              className="rounded-lg border border-grid px-4 py-2 text-sm hover:bg-grid/50 disabled:opacity-50">
              {suggesting ? "מסווג…" : `✨ הצעות AI ללא מסווגים (${rows.filter((r) => !r.category).length})`}
            </button>
          )}
          {meta.aiEnabled && rows.some((r) => !r.category) && (
            <button onClick={researchAll} disabled={searchingAll}
              className="rounded-lg border border-grid px-4 py-2 text-sm hover:bg-grid/50 disabled:opacity-50">
              {searchingAll ? "מחפש ברשת…" : `🔎 חיפוש ברשת (${new Set(rows.filter((r) => !r.category).map((r) => r.merchant_key)).size} עסקים)`}
            </button>
          )}
          {withSuggestion > 0 && (
            <button onClick={approveAll} className="rounded-lg bg-ink px-4 py-2 text-sm text-surface">
              אשר את כל ההצעות ({withSuggestion})
            </button>
          )}
        </div>
      ) : (
        <FilterBar meta={meta} month={month} filters={filters} setFilter={setFilter} onFilters={onFilters}
          q={q} setQ={setQ} count={rows.length} total={total} owners={owners} />
      )}

      {rows.length === 0 ? (
        <p className="card p-8 text-center text-ink-2">{reviewMode ? "הכל מסווג 🎉" : "אין עסקאות"}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-grid text-xs text-muted">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                <th>תאריך</th>
                <th>עסק</th>
                <th className="!text-end">סכום</th>
                <th>כרטיס</th>
                <th>קטגוריה</th>
                <th>טיול</th>
                <th>קבועה</th>
                <th>הערה</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} r={r} owner={owners[r.card] ?? r.card} categories={meta.categories} trips={meta.trips}
                  reviewMode={reviewMode} aiEnabled={meta.aiEnabled} onSave={(p) => save(r, p)}
                  onResearch={async () => {
                    if (!meta.aiEnabled) {
                      flash("כדי להפעיל חיפוש AI: מוסיפים ANTHROPIC_API_KEY לקובץ server/.env ומפעילים מחדש את השרת");
                      return null;
                    }
                    try {
                      const res = await api.research(r.id);
                      await load();
                      return res;
                    } catch (e) {
                      flash(e.message);
                      return null;
                    }
                  }}
                  onApprove={async () => { await api.approve([r.id]); await load(); onChanged(); }} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-surface shadow-lg">{toast}</div>
      )}
    </div>
  );
}

function Row({ r, owner, categories, trips, reviewMode, aiEnabled, onSave, onApprove, onResearch }) {
  const [note, setNote] = useState(r.note ?? "");
  const [searching, setSearching] = useState(false);
  const [suggestion, setSuggestion] = useState(null); // web-search result for an already-reviewed row
  const pending = r.status === "pending";
  const sources = r.ai_sources ? JSON.parse(r.ai_sources) : [];
  const cat = categories.find((c) => c.name === r.category);
  return (
    <tr className={`border-b border-grid/70 last:border-0 [&>td]:px-3 [&>td]:py-2 ${pending ? "text-muted" : ""} ${r.needs_review && !reviewMode ? "bg-series-2/5" : ""}`}>
      <td className="num whitespace-nowrap">{dateLabel(r.purchase_date)}</td>
      <td className="max-w-[16rem]">
        <div className="truncate" title={r.merchant}>{r.merchant}</div>
        <div className="text-xs text-muted">
          {pending ? "בקליטה" : SOURCE[r.category_source] ?? ""}
          {r.ai_reason && <> · {r.ai_reason}</>}
          {r.orig_currency && <> · <span className="num">{r.orig_amount} {r.orig_currency}</span></>}
        </div>
        {suggestion && (suggestion.category !== r.category || suggestion.subcategory !== r.subcategory) && (
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-series-1/10 px-2 py-1 text-xs">
            <span>הצעה: <b>{suggestion.category}{suggestion.subcategory ? ` › ${suggestion.subcategory}` : ""}</b></span>
            <button className="rounded border border-grid bg-surface px-2 py-0.5 hover:bg-grid/50"
              onClick={() => (onSave({ category: suggestion.category, subcategory: suggestion.subcategory ?? "" }), setSuggestion(null))}>החלה</button>
            <button className="text-muted hover:text-ink" onClick={() => setSuggestion(null)} aria-label="ביטול">✕</button>
          </div>
        )}
        {sources.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
            {sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="max-w-[12rem] truncate text-series-1 hover:underline" title={s.url}>
                {s.title || new URL(s.url).hostname}
              </a>
            ))}
          </div>
        )}
      </td>
      <td className={`num whitespace-nowrap text-end font-medium ${r.amount < 0 ? "text-good" : ""}`}>
        {r.amount == null ? "—" : ils(r.amount, 2)}
      </td>
      <td className="whitespace-nowrap text-ink-2">{owner}</td>
      <td>
        <div className="flex items-center gap-1.5">
          <Swatch color={cat?.color} />
          <select value={r.category ?? ""} onChange={(e) => onSave({ category: e.target.value })}
            className={`w-32 rounded-md border bg-surface px-2 py-1 ${r.category ? "border-grid" : "border-series-2"}`} aria-label="קטגוריה">
            <option value="" disabled>בחרו…</option>
            {categories.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
          {cat?.subs.length > 0 && (
            <select value={r.subcategory ?? ""} onChange={(e) => onSave({ category: r.category, subcategory: e.target.value })}
              className={`w-28 rounded-md border bg-surface px-2 py-1 text-ink-2 ${r.subcategory ? "border-grid" : "border-series-2"}`} aria-label="תת־קטגוריה">
              <option value="">—</option>
              {cat.subs.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
        </div>
      </td>
      <td>
        <select value={r.trip_id ?? ""} onChange={(e) => onSave({ trip_id: e.target.value ? Number(e.target.value) : null, applyToMerchant: false })}
          className={`w-28 rounded-md border border-grid bg-surface px-2 py-1 ${r.trip_id ? "" : "text-muted"}`} aria-label="טיול">
          <option value="">—</option>
          {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </td>
      <td>
        <input type="checkbox" checked={!!r.is_fixed} onChange={(e) => onSave({ is_fixed: e.target.checked })}
          aria-label="הוצאה קבועה" className="h-4 w-4" />
      </td>
      <td>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (r.note ?? "") && onSave({ note, applyToMerchant: false })}
          placeholder="—" className="w-40 rounded-md border border-transparent bg-transparent px-2 py-1 hover:border-grid focus:border-grid" />
      </td>
      <td className="whitespace-nowrap">
        {reviewMode && (
          <button disabled={!r.category} onClick={onApprove}
            className="me-1 rounded-md border border-grid px-3 py-1 hover:bg-grid/50 disabled:opacity-40">אישור</button>
        )}
        {!pending && (
          <button disabled={searching}
            title={aiEnabled ? "מה החיוב הזה? חיפוש ברשת לפי שם העסק, הטיול והעסקאות מאותו יום" : "חיפוש AI כבוי: חסר ANTHROPIC_API_KEY"}
            onClick={async () => {
              setSearching(true);
              const res = await onResearch();
              setSearching(false);
              if (res && !reviewMode) setSuggestion(res);
            }}
            className={`rounded-md border border-grid px-2 py-1 hover:bg-grid/50 disabled:opacity-50 ${aiEnabled ? "" : "opacity-50"}`}>
            {searching ? "מחפש…" : "🔎"}
          </button>
        )}
      </td>
    </tr>
  );
}

function FilterBar({ meta, month, filters, setFilter, onFilters, q, setQ, count, total, owners }) {
  const cat = meta.categories.find((c) => c.name === filters.category);
  const trip = meta.trips.find((t) => String(t.id) === filters.trip);
  const chips = [
    filters.card && { key: "card", label: `כרטיס ${owners[filters.card] ?? filters.card}` },
    filters.fixed === "1" && { key: "fixed", label: "קבועות בלבד" },
    filters.notrips === "1" && { key: "notrips", label: "בלי טיולים" },
    filters.weekday && { key: "weekday", label: `יום ${DAYS[Number(filters.weekday)]} (משתנות, בלי טיולים)` },
  ].filter(Boolean);
  const any = Object.keys(filters).length > 0;
  const sel = "rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm";

  return (
    <div className="card grid gap-3 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold">
          {filters.category === "__none" ? "לא מסווג" : filters.category ?? (filters.incomplete === "1" ? "עסקאות שלא סווגו עד הסוף" : "כל העסקאות")}
          {filters.sub && <span className="text-ink-2"> › {filters.sub === "__none" ? "ללא תת־קטגוריה" : filters.sub}</span>}
        </h2>
        <span className="text-sm text-ink-2">{trip ? trip.name : monthLabel(month)}</span>
        <span className="ms-auto text-sm text-ink-2">
          {count} עסקאות · <span className="num font-semibold text-ink">{ils(total, 2)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => (e.preventDefault(), setFilter({ q: q || undefined }))}>
          <input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q !== (filters.q ?? "") && setFilter({ q: q || undefined })}
            placeholder="חיפוש עסק או הערה (Enter)" className={`w-56 ${sel}`} />
        </form>
        <button type="button" role="switch" aria-checked={filters.incomplete === "1"}
          onClick={() => setFilter({ incomplete: filters.incomplete === "1" ? undefined : "1" })}
          title="בלי קטגוריה, או בקטגוריה שיש לה תתי־קטגוריות ולא נבחרה אחת"
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${filters.incomplete === "1" ? "border-series-2 bg-series-2/10 text-ink" : "border-grid bg-surface text-ink-2"}`}>
          <span className={`relative inline-block h-4 w-7 rounded-full transition-colors ${filters.incomplete === "1" ? "bg-series-2" : "bg-axis"}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${filters.incomplete === "1" ? "left-0.5" : "left-3.5"}`} />
          </span>
          לא מסווגות בלבד
        </button>
        <select value={filters.category ?? ""} onChange={(e) => setFilter({ category: e.target.value || undefined, sub: undefined })} className={sel} aria-label="קטגוריה">
          <option value="">כל הקטגוריות</option>
          {meta.categories.map((c) => <option key={c.name}>{c.name}</option>)}
          <option value="__none">לא מסווג</option>
        </select>
        {cat?.subs.length > 0 && (
          <select value={filters.sub ?? ""} onChange={(e) => setFilter({ sub: e.target.value || undefined })} className={sel} aria-label="תת־קטגוריה">
            <option value="">כל התתי־קטגוריות</option>
            {cat.subs.map((s) => <option key={s}>{s}</option>)}
            <option value="__none">ללא תת־קטגוריה</option>
          </select>
        )}
        <select value={filters.trip ?? ""} onChange={(e) => setFilter({ trip: e.target.value || undefined })} className={sel} aria-label="טיול">
          <option value="">{`כל ה${monthLabel(month).startsWith("שנת") ? "שנה" : "חודש"}`}</option>
          {meta.trips.map((t) => <option key={t.id} value={t.id}>טיול: {t.name}</option>)}
        </select>
        {chips.map((c) => (
          <span key={c.key} className="flex items-center gap-1 rounded-full border border-grid px-2.5 py-0.5 text-sm">
            {c.label}
            <button onClick={() => setFilter({ [c.key]: undefined })} className="text-xs text-muted hover:text-critical" aria-label={`הסרת ${c.label}`}>✕</button>
          </span>
        ))}
        {any && <button onClick={() => (setQ(""), onFilters({}))} className="text-sm text-series-1 hover:underline">ניקוי סינון</button>}
      </div>
    </div>
  );
}
