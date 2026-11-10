import express from "express";
import multer from "multer";
import { db, tx, migrateAbroad, rekeyMerchants } from "./db.js";
import { merchantKey } from "./normalize.js";
import { importFile } from "./importService.js";
import { learnRule, categoryTree, categoryOptions, splitOption, classifyWithAi } from "./classify.js";
import { dashboard, months, years, tripDashboard, defaultMonth } from "./dashboard.js";
import { aiEnabled, researchMerchant } from "./ai.js";

rekeyMerchants(merchantKey);
const moved = migrateAbroad();
if (moved) console.log(`migration: ${moved} rows moved from חו״ל back to review (trip tag kept)`);

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.use(express.json());

const wrap = (fn) => (req, res) => {
  try {
    const r = fn(req, res);
    if (r instanceof Promise) r.then((v) => v !== undefined && res.json(v)).catch((e) => fail(res, e));
    else if (r !== undefined) res.json(r);
  } catch (e) {
    fail(res, e);
  }
};
const fail = (res, e) => {
  console.error(e.message);
  res.status(400).json({ error: e.message });
};
const NO_KEY = "דורש ANTHROPIC_API_KEY בקובץ server/.env";

app.get("/api/meta", wrap(() => ({
  categories: db.prepare("SELECT name, color FROM categories").all().reduce(
    (tree, c) => (tree.find((t) => t.name === c.name).color = c.color, tree),
    categoryTree(),
  ),
  cards: db.prepare("SELECT * FROM cards").all(),
  months: months(),
  years: years(),
  defaultMonth: defaultMonth(),
  trips: db.prepare("SELECT * FROM trips ORDER BY start_date DESC").all(),
  aiEnabled: aiEnabled(),
})));

app.post("/api/import", upload.single("file"), wrap(async (req) => {
  if (!req.file) throw new Error("לא הועלה קובץ");
  const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
  return importFile(name, req.file.buffer);
}));

// ---------- dashboards ----------
app.get("/api/dashboard", wrap((req) =>
  dashboard(req.query.month ?? defaultMonth(), { excludeTrips: req.query.trips === "exclude", card: req.query.card || null })));
app.get("/api/trips/:id/dashboard", wrap((req) => tripDashboard(Number(req.params.id))));

// ---------- categories ----------
const catExists = (name) => db.prepare("SELECT 1 FROM categories WHERE name = ?").get(name);

app.post("/api/categories", wrap((req) => {
  const name = String(req.body.name ?? "").trim();
  if (!name) throw new Error("חסר שם");
  if (catExists(name)) throw new Error("כבר קיימת קטגוריה בשם הזה");
  const sort = db.prepare("SELECT IFNULL(MAX(sort),0)+1 AS s FROM categories").get().s;
  db.prepare("INSERT INTO categories(name, sort, color) VALUES (?, ?, ?)").run(name, sort, req.body.color ?? "#c3c2b7");
  return { ok: true };
}));

app.patch("/api/categories/:name", wrap((req) => {
  const old = req.params.name;
  if (!catExists(old)) throw new Error("not found");
  const { name, color } = req.body;
  return tx(() => {
    if (color) db.prepare("UPDATE categories SET color = ? WHERE name = ?").run(color, old);
    if (name && name.trim() !== old) {
      const n = name.trim();
      if (catExists(n)) throw new Error("כבר קיימת קטגוריה בשם הזה");
      db.prepare("UPDATE categories SET name = ? WHERE name = ?").run(n, old); // subcategories cascade
      db.prepare("UPDATE transactions SET category = ? WHERE category = ?").run(n, old);
      db.prepare("UPDATE rules SET category = ? WHERE category = ?").run(n, old);
    }
    return { ok: true };
  });
}));

app.delete("/api/categories/:name", wrap((req) => tx(() => {
  const name = req.params.name;
  const n = db.prepare(
    "UPDATE transactions SET category=NULL, subcategory=NULL, category_source=NULL, needs_review=1 WHERE category=?",
  ).run(name).changes;
  db.prepare("DELETE FROM rules WHERE category = ?").run(name);
  db.prepare("DELETE FROM categories WHERE name = ?").run(name);
  return { ok: true, movedToReview: n };
})));

app.post("/api/categories/:name/subs", wrap((req) => {
  const sub = String(req.body.name ?? "").trim();
  if (!sub) throw new Error("חסר שם");
  if (!catExists(req.params.name)) throw new Error("not found");
  const sort = db.prepare("SELECT IFNULL(MAX(sort),0)+1 AS s FROM subcategories WHERE category=?").get(req.params.name).s;
  db.prepare("INSERT OR IGNORE INTO subcategories(category, name, sort) VALUES (?, ?, ?)").run(req.params.name, sub, sort);
  return { ok: true };
}));

app.patch("/api/categories/:name/subs/:sub", wrap((req) => tx(() => {
  const { name: cat, sub } = req.params;
  const n = String(req.body.name ?? "").trim();
  if (!n) throw new Error("חסר שם");
  db.prepare("UPDATE subcategories SET name=? WHERE category=? AND name=?").run(n, cat, sub);
  db.prepare("UPDATE transactions SET subcategory=? WHERE category=? AND subcategory=?").run(n, cat, sub);
  db.prepare("UPDATE rules SET subcategory=? WHERE category=? AND subcategory=?").run(n, cat, sub);
  return { ok: true };
})));

app.delete("/api/categories/:name/subs/:sub", wrap((req) => tx(() => {
  const { name: cat, sub } = req.params;
  db.prepare("DELETE FROM subcategories WHERE category=? AND name=?").run(cat, sub);
  db.prepare("UPDATE transactions SET subcategory=NULL WHERE category=? AND subcategory=?").run(cat, sub);
  db.prepare("UPDATE rules SET subcategory=NULL WHERE category=? AND subcategory=?").run(cat, sub);
  return { ok: true };
})));

// ---------- transactions ----------
app.get("/api/transactions", wrap((req) => {
  const where = [];
  const params = [];
  const f = req.query;
  // a trip spans its own dates (and pre-paid bookings), so it replaces the period filter
  if (f.month && !f.trip) (where.push("purchase_date LIKE ? || '%'"), params.push(f.month));
  if (f.review === "1") where.push("needs_review = 1 AND status = 'posted'");
  if (f.category === "__none") where.push("category IS NULL");
  else if (f.category) (where.push("category = ?"), params.push(f.category));
  if (f.sub === "__none") where.push("subcategory IS NULL");
  else if (f.sub) (where.push("subcategory = ?"), params.push(f.sub));
  if (f.trip) (where.push("trip_id = ?"), params.push(Number(f.trip)));
  if (f.notrips === "1") where.push("trip_id IS NULL");
  // not fully categorized: no category, or a category that has sub-categories but none chosen
  if (f.incomplete === "1") {
    where.push(`status = 'posted' AND (category IS NULL OR (subcategory IS NULL AND EXISTS
      (SELECT 1 FROM subcategories s WHERE s.category = transactions.category)))`);
  }
  if (f.card) (where.push("card = ?"), params.push(f.card));
  if (f.fixed === "1") where.push("is_fixed = 1");
  if (f.weekday) (where.push("CAST(strftime('%w', purchase_date) AS INTEGER) = ? AND trip_id IS NULL AND is_fixed = 0"), params.push(Number(f.weekday)));
  if (req.query.q) (where.push("(merchant LIKE '%' || ? || '%' OR note LIKE '%' || ? || '%')"), params.push(req.query.q, req.query.q));
  return db
    .prepare(`SELECT * FROM transactions ${where.length ? "WHERE " + where.join(" AND ") : ""}
              ORDER BY purchase_date DESC, id DESC LIMIT 2000`)
    .all(...params);
}));

// Change a transaction. applyToMerchant=true also teaches the rule and re-files other unreviewed rows of that merchant.
app.patch("/api/transactions/:id", wrap((req) => {
  const t = db.prepare("SELECT * FROM transactions WHERE id = ?").get(req.params.id);
  if (!t) throw new Error("not found");
  const b = req.body;
  const category = b.category !== undefined ? b.category || null : t.category;
  // a new category clears a sub-category that belongs to the old one
  const subcategory = b.subcategory !== undefined ? b.subcategory || null : category === t.category ? t.subcategory : null;
  const note = b.note !== undefined ? b.note : t.note;
  const is_fixed = b.is_fixed !== undefined ? (b.is_fixed ? 1 : 0) : t.is_fixed;
  const tripChanged = b.trip_id !== undefined;
  const trip_id = tripChanged ? b.trip_id || null : t.trip_id;
  const applyToMerchant = b.applyToMerchant ?? true;
  const categoryChanged = category !== t.category || subcategory !== t.subcategory;

  return tx(() => {
    db.prepare(
      `UPDATE transactions SET category=?, subcategory=?, note=?, is_fixed=?, trip_id=?,
         trip_manual = CASE WHEN ? THEN 1 ELSE trip_manual END,
         needs_review = CASE WHEN ? THEN 0 ELSE needs_review END,
         category_source = CASE WHEN ? THEN 'manual' ELSE category_source END
       WHERE id=?`,
    ).run(category, subcategory, note, is_fixed, trip_id, tripChanged ? 1 : 0,
      category && (categoryChanged || b.is_fixed !== undefined) ? 1 : 0, categoryChanged ? 1 : 0, t.id);
    let alsoUpdated = 0;
    if (applyToMerchant && category && (categoryChanged || b.is_fixed !== undefined)) {
      learnRule(t.merchant_key, t.merchant, category, is_fixed, { manual: true, subcategory });
      alsoUpdated = db
        .prepare(`UPDATE transactions SET category=?, subcategory=?, is_fixed=?, category_source='rule', needs_review=0
                  WHERE merchant_key=? AND id != ? AND needs_review = 1`)
        .run(category, subcategory, is_fixed, t.merchant_key, t.id).changes;
    }
    return { ok: true, alsoUpdated };
  });
}));

// Accept the suggested categories as they are
app.post("/api/review/approve", wrap((req) => {
  const ids = (req.body.ids ?? []).map(Number);
  return tx(() => {
    let n = 0;
    for (const id of ids) {
      const t = db.prepare("SELECT * FROM transactions WHERE id = ? AND category IS NOT NULL").get(id);
      if (!t) continue;
      db.prepare("UPDATE transactions SET needs_review = 0 WHERE id = ?").run(id);
      learnRule(t.merchant_key, t.merchant, t.category, t.is_fixed, { subcategory: t.subcategory });
      n++;
    }
    return { approved: n };
  });
}));

// AI suggestions (no web) for every review row without a category. Suggestions still need approval.
app.post("/api/review/ai-suggest", wrap(async () => {
  if (!aiEnabled()) throw new Error("הצעות AI " + NO_KEY);
  const rows = db
    .prepare("SELECT * FROM transactions WHERE needs_review=1 AND status='posted' AND category IS NULL")
    .all()
    .map((r) => ({ ...r, needsAi: true }));
  const n = await classifyWithAi(rows);
  const upd = db.prepare("UPDATE transactions SET category=?, subcategory=?, category_source='ai', ai_reason=? WHERE id=?");
  tx(() => rows.filter((r) => r.category).forEach((r) => upd.run(r.category, r.subcategory ?? null, r.ai_reason, r.id)));
  return { suggested: n, total: rows.length };
}));

// Web research for one transaction. Stores a suggestion only; the row stays in review until approved.
async function research(t) {
  const examples = db
    .prepare(`SELECT sample_name AS merchant, category || IFNULL(' > ' || subcategory, '') AS category
              FROM rules ORDER BY manual DESC, rowid DESC LIMIT 30`)
    .all();
  const trip = t.trip_id ? db.prepare("SELECT name, start_date, end_date FROM trips WHERE id=?").get(t.trip_id) : null;
  const sameDay = db
    .prepare("SELECT DISTINCT merchant FROM transactions WHERE purchase_date=? AND id != ? AND merchant_key != ? LIMIT 10")
    .all(t.purchase_date, t.id, t.merchant_key)
    .map((r) => r.merchant);
  const r = await researchMerchant({ ...t, context: { trip, sameDay } }, categoryOptions(), examples);
  const { category, subcategory } = splitOption(r.category);
  const reason = `🔎 ${r.business_description}. ${r.reason}${r.confident ? "" : " (לא בטוח)"}`;
  tx(() => {
    // the explanation is always kept on the row that was searched
    db.prepare("UPDATE transactions SET ai_reason=?, ai_sources=? WHERE id=?").run(reason, JSON.stringify(r.sources), t.id);
    // rows still waiting for review get the suggestion (same merchant), still pending approval
    db.prepare(
      `UPDATE transactions SET category=?, subcategory=?, category_source='web', ai_reason=?, ai_sources=?
       WHERE merchant_key=? AND needs_review=1`,
    ).run(category, subcategory, reason, JSON.stringify(r.sources), t.merchant_key);
  });
  return { ...r, category, subcategory, reason };
}

app.post("/api/transactions/:id/research", wrap(async (req) => {
  const t = db.prepare("SELECT * FROM transactions WHERE id = ?").get(req.params.id);
  if (!t) throw new Error("not found");
  return research(t);
}));

// Research every merchant in the review list that has no suggestion yet (one search per merchant).
app.post("/api/review/research-all", wrap(async () => {
  if (!aiEnabled()) throw new Error("חיפוש ברשת " + NO_KEY);
  const todo = db
    .prepare(`SELECT * FROM transactions WHERE needs_review=1 AND status='posted' AND category IS NULL
              GROUP BY merchant_key ORDER BY purchase_date DESC LIMIT 25`)
    .all();
  let done = 0, failed = 0;
  for (let i = 0; i < todo.length; i += 3) {
    const results = await Promise.allSettled(todo.slice(i, i + 3).map(research));
    results.forEach((r) => (r.status === "fulfilled" ? done++ : (failed++, console.warn(r.reason?.message))));
  }
  return { done, failed };
}));

// ---------- trips (a tag on transactions, not a category) ----------
function retagTrip(id) {
  const t = db.prepare("SELECT * FROM trips WHERE id=?").get(id);
  db.prepare("UPDATE transactions SET trip_id=NULL WHERE trip_id=? AND trip_manual=0").run(id);
  if (!t) return 0;
  return db
    .prepare(`UPDATE transactions SET trip_id=? WHERE purchase_date BETWEEN ? AND ? AND is_fixed=0 AND trip_manual=0`)
    .run(id, t.start_date, t.end_date).changes;
}

app.get("/api/trips", wrap(() => db.prepare("SELECT * FROM trips ORDER BY start_date DESC").all()));

app.post("/api/trips", wrap((req) => {
  const { name, start_date, end_date } = req.body;
  if (!name || !start_date || !end_date) throw new Error("חסר שם או תאריכים");
  if (end_date < start_date) throw new Error("תאריך הסיום לפני תאריך ההתחלה");
  return tx(() => {
    const { lastInsertRowid: id } = db.prepare("INSERT INTO trips(name, start_date, end_date) VALUES (?,?,?)").run(name, start_date, end_date);
    return { id, tagged: retagTrip(id) };
  });
}));

app.patch("/api/trips/:id", wrap((req) => tx(() => {
  const t = db.prepare("SELECT * FROM trips WHERE id=?").get(req.params.id);
  if (!t) throw new Error("not found");
  const { name = t.name, start_date = t.start_date, end_date = t.end_date } = req.body;
  db.prepare("UPDATE trips SET name=?, start_date=?, end_date=? WHERE id=?").run(name, start_date, end_date, t.id);
  return { ok: true, tagged: retagTrip(t.id) };
})));

app.delete("/api/trips/:id", wrap((req) => tx(() => {
  const n = db.prepare("UPDATE transactions SET trip_id=NULL, trip_manual=0 WHERE trip_id=?").run(req.params.id).changes;
  db.prepare("DELETE FROM trips WHERE id=?").run(req.params.id);
  return { ok: true, untagged: n };
})));

app.put("/api/cards/:last4", wrap((req) => {
  db.prepare("INSERT INTO cards(last4, owner) VALUES (?, ?) ON CONFLICT(last4) DO UPDATE SET owner=excluded.owner")
    .run(req.params.last4, req.body.owner);
  return { ok: true };
}));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, "127.0.0.1", () => console.log(`API on http://127.0.0.1:${port} (AI ${aiEnabled() ? "on" : "off"})`));
