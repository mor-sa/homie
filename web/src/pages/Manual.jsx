import { useEffect, useState } from "react";
import { api, ils, dateLabel } from "../api.js";

const field = "rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm";
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthText = (m) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : "");

function Field({ label, children, className = "" }) {
  return <label className={`grid gap-1 text-xs text-ink-2 ${className}`}>{label}{children}</label>;
}

// Category + sub-category selects from the shared tree
function CategoryPick({ categories, value, onChange }) {
  const cat = categories.find((c) => c.name === value.category);
  return (
    <>
      <Field label="קטגוריה">
        <select value={value.category ?? ""} onChange={(e) => onChange({ category: e.target.value, subcategory: "" })} className={field}>
          <option value="">בחירה…</option>
          {categories.map((c) => <option key={c.name}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="תת־קטגוריה">
        <select value={value.subcategory ?? ""} onChange={(e) => onChange({ subcategory: e.target.value })} className={field} disabled={!cat?.subs.length}>
          <option value="">{cat?.subs.length ? "בחירה…" : "—"}</option>
          {cat?.subs.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
    </>
  );
}

// ---------- recurring (rent, house committee, standing orders) ----------

function RecurringForm({ categories, initial, submitLabel, onSubmit, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const editing = initial.id != null;
  const amountChanged = editing && Number(f.amount) !== Number(initial.amount);
  return (
    <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), onSubmit(f))}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="שם" className="sm:col-span-2">
          <input required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="למשל: שכר דירה" className={field} />
        </Field>
        <Field label="סכום לחודש (₪)">
          <input required type="number" min="1" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={`${field} num`} />
        </Field>
        <CategoryPick categories={categories} value={f} onChange={set} />
        <Field label="יום החיוב בחודש">
          <input type="number" min="1" max="31" value={f.day} onChange={(e) => set({ day: e.target.value })} className={`${field} num`} />
        </Field>
        <Field label="מחודש">
          <input required type="month" value={f.start_month} onChange={(e) => set({ start_month: e.target.value })} className={field} />
        </Field>
        <Field label="עד חודש (ריק = ממשיך)">
          <input type="month" value={f.end_month ?? ""} min={f.start_month} onChange={(e) => set({ end_month: e.target.value })} className={field} />
        </Field>
        <Field label="הערה">
          <input value={f.note ?? ""} onChange={(e) => set({ note: e.target.value })} className={field} />
        </Field>
      </div>
      {amountChanged && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg bg-grid/40 p-3">
          <Field label="הסכום החדש חל מחודש">
            <input type="month" value={f.from ?? thisMonth()} min={f.start_month} onChange={(e) => set({ from: e.target.value })} className={field} />
          </Field>
          <p className="text-xs text-ink-2">חודשים קודמים נשארים עם {ils(initial.amount)}, למשל כשהשכירות עלתה בחידוש החוזה.</p>
        </div>
      )}
      <div className="flex gap-2">
        <button className="rounded-lg bg-ink px-3 py-1.5 text-sm text-surface">{submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg border border-grid px-3 py-1.5 text-sm">ביטול</button>}
      </div>
    </form>
  );
}

export function Recurring({ meta, run }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const reload = () => api.recurring().then(setList);
  useEffect(() => { reload(); }, []);
  const act = (fn, msg) => run(fn, msg).then(reload);
  const empty = { name: "", amount: "", category: "", subcategory: "", day: 1, start_month: thisMonth(), end_month: "", note: "" };
  const active = (r) => !r.end_month || r.end_month >= thisMonth();

  return (
    <section className="card grid content-start gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">הוצאות קבועות שלא באשראי</h2>
        {!adding && <button onClick={() => setAdding(true)} className="rounded-lg bg-ink px-3 py-1.5 text-sm text-surface">+ הוצאה קבועה</button>}
      </div>
      <p className="text-sm text-ink-2">
        שכר דירה, ועד בית, הוראות קבע. מגדירים פעם אחת, וכל חודש נכנסת לבד עסקה מסומנת כקבועה, “ללא כרטיס”.
      </p>
      {adding && (
        <div className="rounded-lg border border-grid p-3">
          <RecurringForm categories={meta.categories} initial={empty} submitLabel="הוספה" onCancel={() => setAdding(false)}
            onSubmit={(f) => (act(() => api.addRecurring(f), (r) => `נוסף. ${r.added} חודשים נכנסו.`), setAdding(false))} />
        </div>
      )}
      {list?.length === 0 && !adding && <p className="text-sm text-muted">עוד אין הוצאות קבועות</p>}
      <ul className="grid gap-2">
        {list?.map((r) => editing === r.id ? (
          <li key={r.id} className="rounded-lg border border-grid p-3">
            <RecurringForm categories={meta.categories} initial={{ ...r, end_month: r.end_month ?? "" }} submitLabel="שמירה"
              onCancel={() => setEditing(null)}
              onSubmit={(f) => (act(() => api.updateRecurring(r.id, f), "עודכן"), setEditing(null))} />
          </li>
        ) : (
          <li key={r.id} className={`flex flex-wrap items-center justify-between gap-3 text-sm ${active(r) ? "" : "opacity-60"}`}>
            <span className="min-w-0">
              <span className="block font-medium">{r.name} <span className="num">{ils(r.amount)}</span> לחודש</span>
              <span className="block text-xs text-muted">
                {r.category ?? "בלי קטגוריה"}{r.subcategory ? ` › ${r.subcategory}` : ""} · ב־{r.day} לחודש ·
                {" "}מ־{monthText(r.start_month)} {r.end_month ? `עד ${monthText(r.end_month)}` : "וממשיך"} · {r.months} חודשים נרשמו
              </span>
            </span>
            <span className="flex shrink-0 gap-3 text-xs">
              <button className="hover:underline" onClick={() => setEditing(r.id)}>עריכה</button>
              {active(r) && (
                <button className="hover:underline" onClick={() => confirm(`להפסיק את ${r.name}? ${monthText(thisMonth())} יהיה החודש האחרון, ההיסטוריה נשארת.`) &&
                  act(() => api.updateRecurring(r.id, { end_month: thisMonth() }), "הופסק מהחודש הבא")}>הפסקה</button>
              )}
              {!active(r) && (
                <button className="hover:underline" onClick={() => act(() => api.updateRecurring(r.id, { end_month: "" }), "חודש מחדש")}>חידוש</button>
              )}
              <button className="text-critical hover:underline"
                onClick={() => confirm(`למחוק את ${r.name} ואת ${r.months} החודשים שנרשמו? אי אפשר לבטל.`) && act(() => api.deleteRecurring(r.id), "נמחק")}>מחיקה</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- one-off manual expense ----------

export function ManualExpense({ meta, run }) {
  const today = new Date().toISOString().slice(0, 10);
  const empty = { date: today, merchant: "", amount: "", category: "", subcategory: "", note: "", is_fixed: false };
  const [f, setF] = useState(empty);
  const [list, setList] = useState([]);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const reload = () => api.manual().then(setList);
  useEffect(() => { reload(); }, []);
  const tripName = (id) => meta.trips.find((t) => t.id === id)?.name;

  return (
    <section className="card grid content-start gap-3 p-4">
      <h2 className="font-semibold">הוצאה חד־פעמית</h2>
      <p className="text-sm text-ink-2">העברה בנקאית, מזומן, כל דבר שלא מופיע בפירוט האשראי.</p>
      <form className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => (e.preventDefault(), run(() => api.addManual(f), (r) => r.trip ? `נוסף ותויג לטיול ${tripName(r.trip)}` : "נוסף").then(() => (setF(empty), reload())))}>
        <Field label="תאריך"><input required type="date" value={f.date} max={today} onChange={(e) => set({ date: e.target.value })} className={field} /></Field>
        <Field label="תיאור"><input required value={f.merchant} onChange={(e) => set({ merchant: e.target.value })} placeholder="למשל: אינסטלטור" className={field} /></Field>
        <Field label="סכום (₪)"><input required type="number" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={`${field} num`} /></Field>
        <CategoryPick categories={meta.categories} value={f} onChange={set} />
        <Field label="הערה"><input value={f.note} onChange={(e) => set({ note: e.target.value })} className={field} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.is_fixed} onChange={(e) => set({ is_fixed: e.target.checked })} /> הוצאה קבועה
        </label>
        <button className="rounded-lg bg-ink px-3 py-1.5 text-sm text-surface">הוספה</button>
      </form>
      {list.length > 0 && (
        <div className="border-t border-grid pt-3">
          <h3 className="mb-2 text-sm font-semibold">נוספו לאחרונה</h3>
          <ul className="grid gap-1.5">
            {list.slice(0, 10).map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="num text-muted">{dateLabel(t.purchase_date)}</span> {t.merchant}
                  <span className="text-xs text-muted"> · {t.category ?? "בלי קטגוריה"}{t.trip_id ? ` · ${tripName(t.trip_id)}` : ""}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className="num">{ils(t.amount, 2)}</span>
                  <button className="text-xs text-critical hover:underline"
                    onClick={() => confirm(`למחוק את ${t.merchant}?`) && run(() => api.deleteManual(t.id), "נמחק").then(reload)}>מחיקה</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
