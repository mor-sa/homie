import { useEffect, useRef, useState } from "react";
import { api, ils } from "../api.js";

const field = "rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm";
const photoUrl = (name) => `/api/wishlist/photos/${name}`;
const MATCH = { same: "אותו מוצר", very_similar: "דומה מאוד", similar: "דומה" };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

// Phone photos are often 5–10MB; shrink to ≤1600px JPEG before upload (also what the search sees)
async function shrink(file) {
  if (!file.type.startsWith("image/")) throw new Error("זה לא קובץ תמונה");
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("הדפדפן לא הצליח לפתוח את התמונה (HEIC? נסי לצלם מסך שלה)"); });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}

function Field({ label, children, className = "" }) {
  return <label className={`grid gap-1 text-xs text-ink-2 ${className}`}>{label}{children}</label>;
}

// Click, drop or paste (⌘V) an image
function PhotoPick({ file, current, onFile, onRemove, paste }) {
  const [preview, setPreview] = useState(null);
  const [drag, setDrag] = useState(false);
  const input = useRef();
  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    if (!paste) return;
    const onPaste = (e) => {
      const f = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (f) (e.preventDefault(), onFile(f));
    };
    addEventListener("paste", onPaste);
    return () => removeEventListener("paste", onPaste);
  }, [onFile, paste]);
  const src = preview ?? (current ? photoUrl(current) : null);

  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => (e.preventDefault(), setDrag(false), e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]))}
      className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed text-center ${drag ? "border-series-1 bg-series-1/5" : "border-grid"}`}
    >
      {src ? (
        <>
          <img src={src} alt="" className="h-full w-full object-cover" />
          <span className="absolute bottom-2 start-2 flex gap-1.5">
            <button type="button" onClick={() => input.current.click()} className="rounded-md bg-surface/90 px-2 py-1 text-xs shadow">החלפה</button>
            <button type="button" onClick={onRemove} className="rounded-md bg-surface/90 px-2 py-1 text-xs text-critical shadow">הסרה</button>
          </span>
        </>
      ) : (
        <button type="button" onClick={() => input.current.click()} className="grid h-full w-full place-content-center gap-1 p-3 text-sm text-ink-2">
          <span className="text-2xl" aria-hidden>📷</span>
          תמונה: לחיצה, גרירה, או הדבקה
        </button>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
    </div>
  );
}

function WishForm({ initial = {}, submitLabel, onSubmit, onCancel }) {
  const [f, setF] = useState({ title: initial.title ?? "", price: initial.price ?? "", url: initial.url ?? "", note: initial.note ?? "" });
  const [file, setFile] = useState(null);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const pick = async (raw) => {
    try { setErr(null); setFile(await shrink(raw)); setRemoved(false); } catch (e) { setErr(e.message); }
  };
  const hasPhoto = file || (!removed && initial.photo);

  async function submit(e) {
    e.preventDefault();
    if (!f.title.trim() && !hasPhoto) return setErr("צריך שם או תמונה");
    setBusy(true);
    try {
      await onSubmit({ ...f, photo: file ?? undefined, remove_photo: removed && !file ? "1" : undefined });
      setF({ title: "", price: "", url: "", note: "" }); setFile(null); setRemoved(false); setErr(null);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[180px_1fr]">
      <PhotoPick paste={initial.id == null} file={file} current={removed ? null : initial.photo} onFile={pick} onRemove={() => (setFile(null), setRemoved(true))} />
      <div className="grid content-start gap-3 sm:grid-cols-2">
        <Field label="מה זה" className="sm:col-span-2">
          <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="למשל: מנורת עמידה מקש. אפשר להשאיר ריק אם יש תמונה" className={field} />
        </Field>
        <Field label="מחיר שראינו (₪)">
          <input type="number" min="0" step="0.01" value={f.price} onChange={(e) => set({ price: e.target.value })} className={`${field} num`} />
        </Field>
        <Field label="קישור">
          <input type="url" dir="ltr" value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" className={field} />
        </Field>
        <Field label="הערות (מידה, צבע, לאיזה חדר)" className="sm:col-span-2">
          <input value={f.note} onChange={(e) => set({ note: e.target.value })} className={field} />
        </Field>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm text-surface disabled:opacity-50">{busy ? "שומרת…" : submitLabel}</button>
          {onCancel && <button type="button" onClick={onCancel} className="rounded-lg border border-grid px-3 py-1.5 text-sm">ביטול</button>}
          {err && <span className="text-sm text-critical">{err}</span>}
        </div>
      </div>
    </form>
  );
}

function Results({ search, searchedAt }) {
  if (!search) return null;
  const priced = search.results.filter((r) => r.price != null);
  const min = priced.length ? Math.min(...priced.map((r) => r.price)) : null;
  return (
    <div className="grid gap-2 border-t border-grid pt-3">
      <p className="text-sm text-ink-2">
        <span className="font-medium text-ink">זיהוי: </span>{search.identified}
      </p>
      {search.results.length === 0 ? (
        <p className="text-sm text-muted">לא נמצאו חנויות עם קישור בדוק. אפשר לנסות שוב, או להוסיף שם/הערה מדויקים יותר.</p>
      ) : (
        <ul className="grid gap-1.5">
          {search.results.map((r, i) => (
            <li key={i}>
              <a href={r.url} target="_blank" rel="noreferrer noopener"
                className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-grid/50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{r.title}</span>
                  <span className="block text-xs text-muted">
                    {r.store || host(r.url)} · {MATCH[r.match] ?? r.match}{r.note ? ` · ${r.note}` : ""}
                  </span>
                </span>
                <span className={`num shrink-0 text-sm ${r.price != null && r.price === min ? "font-semibold text-good" : ""}`}>
                  {r.price != null ? ils(r.price) : <span className="text-xs text-muted">אין מחיר</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        המחירים כפי שהופיעו בחיפוש{searchedAt ? ` ב־${searchedAt.slice(8, 10)}/${searchedAt.slice(5, 7)}` : ""}, כדאי לוודא באתר לפני קנייה.
      </p>
    </div>
  );
}

function WishCard({ item, aiEnabled, onChange, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);
  const bought = item.status === "bought";
  const best = item.search?.results.filter((r) => r.price != null).sort((a, b) => a.price - b.price)[0];

  async function search() {
    setSearching(true); setErr(null);
    try { onChange(await api.searchWish(item.id)); setOpen(true); } catch (e) { setErr(e.message); }
    setSearching(false);
  }
  const act = async (fn) => { try { setErr(null); await fn(); } catch (e) { setErr(e.message); } };

  if (editing) {
    return (
      <li className="card p-3 sm:col-span-2 lg:col-span-3">
        <WishForm initial={item} submitLabel="שמירה" onCancel={() => setEditing(false)}
          onSubmit={async (f) => (onChange(await api.updateWish(item.id, f)), setEditing(false))} />
      </li>
    );
  }

  return (
    <li className={`card flex flex-col overflow-hidden ${bought ? "opacity-60" : ""}`}>
      {item.photo ? (
        <img src={photoUrl(item.photo)} alt={item.title} className="aspect-[4/3] w-full bg-grid/40 object-cover" loading="lazy" />
      ) : (
        <div className="grid aspect-[4/3] w-full place-content-center bg-grid/40 text-3xl text-muted" aria-hidden>🛋️</div>
      )}
      <div className="grid flex-1 content-start gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className={`font-semibold ${bought ? "line-through" : ""}`}>{item.title}</h3>
          {item.price != null && <span className="num shrink-0 text-sm">{ils(item.price)}</span>}
        </div>
        {item.note && <p className="text-sm text-ink-2">{item.note}</p>}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer noopener" className="w-fit text-xs text-series-1 hover:underline" dir="ltr">{host(item.url)}</a>
        )}
        {best && !open && (
          <button onClick={() => setOpen(true)} className="w-fit text-start text-sm text-ink-2 hover:underline">
            נמצאו {item.search.results.length} הצעות, החל מ־<span className="num font-semibold text-good">{ils(best.price)}</span> ({best.store})
          </button>
        )}
        {item.search && !best && !open && (
          <button onClick={() => setOpen(true)} className="w-fit text-sm text-ink-2 hover:underline">תוצאות החיפוש ({item.search.results.length})</button>
        )}
        {open && <Results search={item.search} searchedAt={item.searched_at} />}
        {open && <button onClick={() => setOpen(false)} className="w-fit text-xs text-muted hover:underline">הסתרת התוצאות</button>}
        {err && <p className="text-sm text-critical">{err}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-grid px-3 py-2 text-xs">
        {!bought && (
          <button onClick={search} disabled={searching || !aiEnabled}
            title={aiEnabled ? "זיהוי מהתמונה וחיפוש בחנויות בישראל" : "דורש ANTHROPIC_API_KEY בקובץ server/.env"}
            className="rounded-md bg-ink px-2 py-1 font-medium text-surface disabled:opacity-40">
            {searching ? "מחפש… (כדקה)" : item.search ? "חיפוש מחדש" : "✨ חיפוש חכם"}
          </button>
        )}
        <button className="hover:underline" onClick={() => act(async () => onChange(await api.updateWish(item.id, { status: bought ? "want" : "bought" })))}>
          {bought ? "החזרה לרשימה" : "✓ נקנה"}
        </button>
        <button className="hover:underline" onClick={() => setEditing(true)}>עריכה</button>
        <button className="ms-auto text-critical hover:underline"
          onClick={() => confirm(`למחוק את ${item.title}?`) && act(async () => (await api.deleteWish(item.id), onRemove()))}>מחיקה</button>
      </div>
    </li>
  );
}

export default function Wishlist({ meta }) {
  const [items, setItems] = useState(null);
  const [view, setView] = useState("want");
  useEffect(() => { api.wishlist().then(setItems); }, []);
  const replace = (it) => setItems((xs) => xs.map((x) => (x.id === it.id ? it : x)));
  const shown = items?.filter((i) => i.status === view) ?? [];
  const count = (s) => items?.filter((i) => i.status === s).length ?? 0;
  const wantTotal = items?.filter((i) => i.status === "want" && i.price != null).reduce((s, i) => s + i.price, 0) ?? 0;

  return (
    <div className="grid gap-4">
      <section className="card grid gap-3 p-4">
        <h2 className="font-semibold">מה בא לנו לקנות</h2>
        <p className="text-sm text-ink-2">
          מוסיפים תמונה (צילום, צילום מסך, או הדבקה) ו/או שם. “חיפוש חכם” מזהה מה זה ומחפש את אותו מוצר או דומים בחנויות בישראל, עם מחירים.
        </p>
        {!meta.aiEnabled && (
          <p className="rounded-lg bg-grid/50 p-2 text-xs text-ink-2">
            החיפוש החכם עוד לא פעיל: צריך להוסיף את ANTHROPIC_API_KEY לקובץ server/.env. הרשימה עצמה עובדת גם בלי.
          </p>
        )}
        <WishForm submitLabel="הוספה לרשימה" onSubmit={async (f) => {
          const it = await api.addWish(f);
          setItems((xs) => [it, ...xs]);
          setView("want");
        }} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-grid/50 p-1 text-sm">
          {[["want", "רוצים"], ["bought", "נקנו"]].map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`rounded-md px-3 py-1 ${view === id ? "bg-surface font-medium shadow-sm" : "text-ink-2"}`}>
              {label} <span className="num text-muted">{count(id)}</span>
            </button>
          ))}
        </div>
        {view === "want" && wantTotal > 0 && (
          <span className="text-sm text-ink-2">סך הכל לפי המחירים שראינו: <span className="num font-medium text-ink">{ils(wantTotal)}</span></span>
        )}
      </div>

      {items && shown.length === 0 && (
        <p className="text-sm text-muted">{view === "want" ? "הרשימה ריקה. אפשר להתחיל מתמונה." : "עוד לא סימנו שום דבר כנקנה."}</p>
      )}
      <ul className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((it) => (
          <WishCard key={it.id} item={it} aiEnabled={meta.aiEnabled} onChange={replace}
            onRemove={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} />
        ))}
      </ul>
    </div>
  );
}
