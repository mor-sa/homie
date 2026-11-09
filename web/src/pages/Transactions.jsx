import { useEffect, useMemo, useState } from "react";
import { api, ils, dateLabel } from "../api.js";
import { Swatch } from "../components/charts.jsx";

const SOURCE = { rule: "לפי עסק", trip: "טיול", ai: "הצעת AI", web: "חיפוש ברשת", manual: "ידני", history: "מהגיליון" };

export default function Transactions({ meta, month, reviewMode = false, onChanged }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [toast, setToast] = useState(null);
  const owners = useMemo(() => Object.fromEntries(meta.cards.map((c) => [c.last4, c.owner])), [meta.cards]);

  const load = () =>
    api.transactions(reviewMode ? { review: "1" } : { month, category, q }).then(setRows);
  useEffect(() => {
    load();
  }, [month, category, q, reviewMode]);

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
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש עסק או הערה"
            className="w-56 rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm" />
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm">
            <option value="">כל הקטגוריות</option>
            {meta.categories.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
          <span className="ms-auto text-sm text-ink-2">
            {rows.length} עסקאות · <span className="num font-semibold text-ink">{ils(total, 2)}</span>
          </span>
        </div>
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
                {reviewMode && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} r={r} owner={owners[r.card] ?? r.card} categories={meta.categories} trips={meta.trips}
                  reviewMode={reviewMode} aiEnabled={meta.aiEnabled} onSave={(p) => save(r, p)}
                  onResearch={async () => {
                    try { await api.research(r.id); } catch (e) { flash(e.message); }
                    await load();
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
        {reviewMode && sources.length > 0 && (
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
              className="w-28 rounded-md border border-grid bg-surface px-2 py-1 text-ink-2" aria-label="תת־קטגוריה">
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
      {reviewMode && (
        <td className="whitespace-nowrap">
          <button disabled={!r.category} onClick={onApprove}
            className="rounded-md border border-grid px-3 py-1 hover:bg-grid/50 disabled:opacity-40">אישור</button>
          {aiEnabled && (
            <button disabled={searching} title="חיפוש ברשת מה העסק הזה"
              onClick={async () => { setSearching(true); await onResearch(); setSearching(false); }}
              className="ms-1 rounded-md border border-grid px-2 py-1 hover:bg-grid/50 disabled:opacity-50">
              {searching ? "…" : "🔎"}
            </button>
          )}
        </td>
      )}
    </tr>
  );
}
