// Expenses that don't come from a card file: recurring ones (rent, house committee, standing orders) that
// enter every month on their own, and one-off manual ones (bank transfer, cash). Both are ordinary
// transactions with card = 'manual', so every view, filter and chart counts them like any other row.
import { db, tx } from "./db.js";
import { merchantKey } from "./normalize.js";

export const MANUAL_CARD = "manual";

db.exec(`
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT,
  subcategory TEXT,
  day INTEGER NOT NULL DEFAULT 1,      -- day of month it's paid
  start_month TEXT NOT NULL,           -- YYYY-MM, first month it applies
  end_month TEXT,                      -- YYYY-MM, last month (NULL = ongoing)
  note TEXT
);
`);

const ensureManualCard = () =>
  db.prepare("INSERT OR IGNORE INTO cards(last4, owner) VALUES (?, 'ללא כרטיס')").run(MANUAL_CARD);

const today = () => new Date().toISOString().slice(0, 10);
const nextMonth = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
};
const dateIn = (month, day) => {
  const [y, mo] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(day, 1), last)).padStart(2, "0")}`;
};
const recKey = (id, month) => `rec:${id}:${month}`;

/** Adds the missing monthly rows of every recurring expense, up to today. Existing rows are left alone. */
export function materializeRecurring() {
  const rules = db.prepare("SELECT * FROM recurring").all();
  if (!rules.length) return 0;
  ensureManualCard();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO transactions
       (dedupe_key, card, purchase_date, merchant, merchant_key, amount, txn_type, status, category, subcategory,
        category_source, needs_review, is_fixed, note)
     VALUES (?, ?, ?, ?, ?, ?, 'הוראת קבע', 'posted', ?, ?, 'manual', 0, 1, ?)`,
  );
  const now = today();
  let added = 0;
  tx(() => {
    for (const r of rules) {
      for (let m = r.start_month; m <= now.slice(0, 7) && (!r.end_month || m <= r.end_month); m = nextMonth(m)) {
        const date = dateIn(m, r.day);
        if (date > now) break;
        added += insert.run(recKey(r.id, m), MANUAL_CARD, date, r.name, merchantKey(r.name), r.amount,
          r.category, r.subcategory, r.note).changes;
      }
    }
  });
  return added;
}

const validMonth = (m) => /^\d{4}-\d{2}$/.test(m ?? "");

export function registerManualRoutes(app, wrap) {
  app.get("/api/recurring", wrap(() =>
    db.prepare(
      `SELECT r.*, COUNT(t.id) AS months, MAX(t.purchase_date) AS last_date
       FROM recurring r LEFT JOIN transactions t ON t.dedupe_key LIKE 'rec:' || r.id || ':%'
       GROUP BY r.id ORDER BY r.end_month IS NOT NULL, r.amount DESC`,
    ).all()));

  app.post("/api/recurring", wrap((req) => {
    const { name, amount, category, subcategory, day = 1, start_month, end_month, note } = req.body;
    if (!name?.trim() || !(Number(amount) > 0) || !validMonth(start_month)) throw new Error("חסר שם, סכום או חודש התחלה");
    if (end_month && (!validMonth(end_month) || end_month < start_month)) throw new Error("חודש הסיום לפני חודש ההתחלה");
    const id = db.prepare(
      "INSERT INTO recurring(name, amount, category, subcategory, day, start_month, end_month, note) VALUES (?,?,?,?,?,?,?,?)",
    ).run(name.trim(), Number(amount), category || null, subcategory || null, Number(day) || 1, start_month, end_month || null, note || null)
      .lastInsertRowid;
    return { id, added: materializeRecurring() };
  }));

  // Edit. A new amount applies from `from` (YYYY-MM, default: this month) on; earlier months keep what was paid.
  app.patch("/api/recurring/:id", wrap((req) => tx(() => {
    const r = db.prepare("SELECT * FROM recurring WHERE id=?").get(req.params.id);
    if (!r) throw new Error("not found");
    const b = req.body;
    const next = {
      name: b.name?.trim() || r.name,
      amount: b.amount != null ? Number(b.amount) : r.amount,
      category: b.category !== undefined ? b.category || null : r.category,
      subcategory: b.subcategory !== undefined ? b.subcategory || null : b.category !== undefined && b.category !== r.category ? null : r.subcategory,
      day: b.day != null ? Number(b.day) || 1 : r.day,
      start_month: validMonth(b.start_month) ? b.start_month : r.start_month,
      end_month: b.end_month !== undefined ? (validMonth(b.end_month) ? b.end_month : null) : r.end_month,
      note: b.note !== undefined ? b.note || null : r.note,
    };
    if (next.end_month && next.end_month < next.start_month) throw new Error("חודש הסיום לפני חודש ההתחלה");
    db.prepare("UPDATE recurring SET name=?, amount=?, category=?, subcategory=?, day=?, start_month=?, end_month=?, note=? WHERE id=?")
      .run(next.name, next.amount, next.category, next.subcategory, next.day, next.start_month, next.end_month, next.note, r.id);

    const like = `rec:${r.id}:%`;
    db.prepare("UPDATE transactions SET merchant=?, merchant_key=?, category=?, subcategory=?, note=? WHERE dedupe_key LIKE ?")
      .run(next.name, merchantKey(next.name), next.category, next.subcategory, next.note, like);
    if (next.amount !== r.amount) {
      const from = validMonth(b.from) ? b.from : today().slice(0, 7);
      db.prepare("UPDATE transactions SET amount=? WHERE dedupe_key LIKE ? AND substr(purchase_date,1,7) >= ?").run(next.amount, like, from);
    }
    // months now outside the range go away
    db.prepare(`DELETE FROM transactions WHERE dedupe_key LIKE ? AND (substr(purchase_date,1,7) < ? OR (? IS NOT NULL AND substr(purchase_date,1,7) > ?))`)
      .run(like, next.start_month, next.end_month, next.end_month);
    return { ok: true, added: materializeRecurring() };
  })));

  // Delete the rule and all the months it created (to just stop it, PATCH end_month instead)
  app.delete("/api/recurring/:id", wrap((req) => tx(() => {
    const n = db.prepare("DELETE FROM transactions WHERE dedupe_key LIKE ?").run(`rec:${Number(req.params.id)}:%`).changes;
    db.prepare("DELETE FROM recurring WHERE id=?").run(req.params.id);
    return { ok: true, removed: n };
  })));

  // One-off manual expense. A date inside a trip tags it with that trip (unless it's fixed).
  app.post("/api/manual", wrap((req) => {
    const { date, merchant, amount, category, subcategory, note, is_fixed } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !merchant?.trim() || !Number(amount)) throw new Error("חסר תאריך, תיאור או סכום");
    ensureManualCard();
    const trip = is_fixed ? null : db.prepare("SELECT id FROM trips WHERE ? BETWEEN start_date AND end_date ORDER BY start_date DESC").get(date);
    const id = db.prepare(
      `INSERT INTO transactions (dedupe_key, card, purchase_date, merchant, merchant_key, amount, txn_type, status, category,
         subcategory, category_source, needs_review, is_fixed, note, trip_id)
       VALUES (?, ?, ?, ?, ?, ?, 'ידני', 'posted', ?, ?, 'manual', ?, ?, ?, ?)`,
    ).run(`manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, MANUAL_CARD, date, merchant.trim(), merchantKey(merchant),
      Number(amount), category || null, subcategory || null, category ? 0 : 1, is_fixed ? 1 : 0, note || null, trip?.id ?? null)
      .lastInsertRowid;
    return { id, trip: trip?.id ?? null };
  }));

  app.get("/api/manual", wrap(() =>
    db.prepare("SELECT * FROM transactions WHERE dedupe_key LIKE 'manual:%' ORDER BY purchase_date DESC, id DESC LIMIT 50").all()));

  app.delete("/api/manual/:id", wrap((req) => {
    const n = db.prepare("DELETE FROM transactions WHERE id=? AND dedupe_key LIKE 'manual:%'").run(req.params.id).changes;
    if (!n) throw new Error("אפשר למחוק רק הוצאה שנוספה ידנית");
    return { ok: true };
  }));
}
