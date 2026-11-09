import { useState } from "react";
import { api, dateLabel } from "../api.js";
import { Swatch } from "../components/charts.jsx";

export default function Settings({ meta, onChanged }) {
  const [msg, setMsg] = useState(null);
  const run = async (fn, ok) => {
    try {
      const r = await fn();
      setMsg(typeof ok === "function" ? ok(r) : ok ?? null);
      await onChanged();
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="grid gap-4">
      {msg && <p className="card border-series-1/40 p-3 text-sm">{msg}</p>}
      <Categories meta={meta} run={run} />
      <div className="grid gap-4 md:grid-cols-2">
        <TripsEditor trips={meta.trips} run={run} />
        <Cards cards={meta.cards} run={run} />
      </div>
    </div>
  );
}

function Categories({ meta, run }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#9fc5e8");
  return (
    <section className="card p-4">
      <h2 className="font-semibold">קטגוריות</h2>
      <p className="mb-4 text-sm text-ink-2">
        הצבעים נלקחו מהגיליון שלך. לחיצה על שם משנה אותו (גם בכל העסקאות). תת־קטגוריות לא חובה: עסקה יכולה להיות רק בקטגוריה.
      </p>
      <ul className="grid gap-3">
        {meta.categories.map((c) => <CategoryRow key={c.name} c={c} run={run} />)}
      </ul>
      <form className="mt-4 flex flex-wrap items-center gap-2 border-t border-grid pt-4"
        onSubmit={(e) => (e.preventDefault(), run(() => api.addCategory({ name, color }), `נוספה הקטגוריה ${name}`), setName(""))}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-grid" aria-label="צבע" />
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="קטגוריה חדשה"
          className="w-48 rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm" />
        <button className="rounded-lg bg-ink px-3 py-1.5 text-sm text-surface">הוספה</button>
      </form>
    </section>
  );
}

function CategoryRow({ c, run }) {
  const [sub, setSub] = useState("");
  const rename = () => {
    const n = prompt("שם חדש לקטגוריה", c.name);
    if (n && n !== c.name) run(() => api.updateCategory(c.name, { name: n }));
  };
  const remove = () => {
    if (confirm(`למחוק את "${c.name}"? העסקאות שלה יחזרו לרשימת האישור.`))
      run(() => api.deleteCategory(c.name), (r) => `נמחקה. ${r.movedToReview} עסקאות חזרו לאישור.`);
  };
  return (
    <li className="grid gap-2 border-b border-grid/60 pb-3 last:border-0 sm:grid-cols-[13rem_1fr] sm:items-start">
      <div className="flex items-center gap-2">
        <label className="relative cursor-pointer" title="שינוי צבע">
          <Swatch color={c.color} size={20} />
          <input type="color" value={c.color ?? "#c3c2b7"} className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => run(() => api.updateCategory(c.name, { color: e.target.value }))} aria-label={`צבע ${c.name}`} />
        </label>
        <button onClick={rename} className="font-medium hover:underline">{c.name}</button>
        <button onClick={remove} className="ms-auto text-xs text-muted hover:text-critical sm:ms-1" aria-label={`מחיקת ${c.name}`}>✕</button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {c.subs.map((s) => (
          <span key={s} className="group flex items-center gap-1 rounded-full border border-grid px-2.5 py-0.5 text-sm">
            <button onClick={() => { const n = prompt("שם חדש", s); if (n && n !== s) run(() => api.renameSub(c.name, s, n)); }}>{s}</button>
            <button onClick={() => run(() => api.deleteSub(c.name, s))} className="text-xs text-muted hover:text-critical" aria-label={`מחיקת ${s}`}>✕</button>
          </span>
        ))}
        <form onSubmit={(e) => (e.preventDefault(), sub && run(() => api.addSub(c.name, sub)), setSub(""))}>
          <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="+ תת־קטגוריה"
            className="w-32 rounded-full border border-dashed border-grid bg-transparent px-2.5 py-0.5 text-sm" />
        </form>
      </div>
    </li>
  );
}

function TripsEditor({ trips, run }) {
  const empty = { name: "", start_date: "", end_date: "" };
  const [form, setForm] = useState(empty);
  return (
    <section className="card grid content-start gap-3 p-4">
      <h2 className="font-semibold">טיולים</h2>
      <p className="text-sm text-ink-2">
        טיול הוא תווית ולא קטגוריה: הוצאה במסעדה ברומא היא “אוכל בחוץ” עם התווית של הטיול. כל העסקאות בטווח התאריכים מתויגות,
        חוץ מהוצאות קבועות. הזמנות ששולמו מראש מצמידים לטיול ידנית ממסך העסקאות.
      </p>
      <ul className="grid gap-2">
        {trips.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
            <span>{t.name} <span className="num text-muted">{dateLabel(t.start_date)}–{dateLabel(t.end_date)}</span></span>
            <span className="flex gap-3 text-xs">
              <button className="hover:underline" onClick={() => {
                const s = prompt("תאריך התחלה (YYYY-MM-DD)", t.start_date);
                const e = s && prompt("תאריך סיום (YYYY-MM-DD)", t.end_date);
                if (s && e) run(() => api.updateTrip(t.id, { start_date: s, end_date: e }), (r) => `עודכן. ${r.tagged} עסקאות בטיול.`);
              }}>תאריכים</button>
              <button className="text-critical hover:underline"
                onClick={() => confirm(`למחוק את ${t.name}? העסקאות נשארות, רק התווית יורדת.`) && run(() => api.deleteTrip(t.id), "הטיול נמחק")}>מחיקה</button>
            </span>
          </li>
        ))}
      </ul>
      <form className="grid gap-2 border-t border-grid pt-3"
        onSubmit={(e) => (e.preventDefault(), run(() => api.addTrip(form), (r) => `הטיול נוסף, ${r.tagged} עסקאות תויגו.`), setForm(empty))}>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="שם, למשל: יוון 2027" className="rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input required type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            className="rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm" aria-label="מתאריך" />
          <input required type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            className="rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm" aria-label="עד תאריך" />
        </div>
        <button className="rounded-lg bg-ink px-3 py-1.5 text-sm text-surface">הוספת טיול</button>
      </form>
    </section>
  );
}

function Cards({ cards, run }) {
  return (
    <section className="card grid content-start gap-3 p-4">
      <h2 className="font-semibold">כרטיסים</h2>
      <ul className="grid gap-2">
        {cards.map((c) => (
          <li key={c.last4} className="flex items-center gap-3 text-sm">
            <span className="num text-muted">•••• {c.last4}</span>
            <input defaultValue={c.owner} className="w-32 rounded-lg border border-grid bg-surface px-2 py-1"
              onBlur={(e) => e.target.value !== c.owner && run(() => api.setCardOwner(c.last4, e.target.value), "נשמר")} />
          </li>
        ))}
      </ul>
    </section>
  );
}
