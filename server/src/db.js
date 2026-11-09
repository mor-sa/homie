import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = resolve(process.env.DB_PATH ?? new URL("../data/expenses.db", import.meta.url).pathname);
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cards (
  last4 TEXT PRIMARY KEY,
  owner TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,   -- YYYY-MM-DD inclusive
  end_date TEXT NOT NULL,     -- YYYY-MM-DD inclusive
  category TEXT NOT NULL DEFAULT 'חו״ל'
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'cal' | 'history'
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  added INTEGER NOT NULL DEFAULT 0
);

-- merchant_key -> category, learned from history and manual fixes.
-- votes is a JSON object {category: count}; the rule is ambiguous when >1 category has votes.
CREATE TABLE IF NOT EXISTS rules (
  merchant_key TEXT PRIMARY KEY,
  sample_name TEXT NOT NULL,
  category TEXT NOT NULL,
  votes TEXT NOT NULL DEFAULT '{}',
  is_fixed INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  card TEXT,
  purchase_date TEXT NOT NULL,     -- YYYY-MM-DD
  charge_date TEXT,                -- YYYY-MM-DD
  merchant TEXT NOT NULL,
  merchant_key TEXT NOT NULL,
  amount REAL,                     -- ILS; NULL while pending
  orig_amount REAL,
  orig_currency TEXT,
  txn_type TEXT,
  status TEXT NOT NULL DEFAULT 'posted',   -- 'posted' | 'pending'
  category TEXT,
  category_source TEXT,            -- 'rule' | 'trip' | 'ai' | 'manual' | 'history'
  ai_reason TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  is_fixed INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  import_id INTEGER REFERENCES imports(id)
);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(purchase_date);
CREATE INDEX IF NOT EXISTS tx_merchant ON transactions(merchant_key);
`);

// ---- migrations for columns added after the first version ----
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const addCol = (t, c, def) => cols(t).includes(c) || db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
addCol("transactions", "ai_sources", "TEXT");               // JSON [{url,title}] from web research
addCol("transactions", "subcategory", "TEXT");
addCol("transactions", "trip_manual", "INTEGER NOT NULL DEFAULT 0");
addCol("transactions", "sector", "TEXT"); // the card company's own merchant sector ("ענף"), a hint for AI // trip set by hand (e.g. a booking paid in advance)
addCol("rules", "subcategory", "TEXT");
addCol("categories", "color", "TEXT");

db.exec(`
CREATE TABLE IF NOT EXISTS subcategories (
  category TEXT NOT NULL REFERENCES categories(name) ON UPDATE CASCADE ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category, name)
);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);
`);

const DEFAULT_CATEGORIES = {
  "סופר": [],
  "אוכל בחוץ": ["מסעדות", "בתי קפה ומאפיות", "משלוחים", "אוכל רחוב"],
  "בילוי": ["ברים", "אטרקציות ומוזיאונים", "הופעות ואירועים"],
  "לבית": ["ריהוט", "כלי בית", "תיקונים ושיפוצים"],
  "תחבורה": ["טיסות", "מוניות", "תחבורה ציבורית", "דלק", "חניה", "השכרת רכב"],
  "לינה": ["מלונות", "דירות"],
  "טיפוח": [],
  "בריאות": ["רופאים", "תרופות", "אופטיקה"],
  "ביגוד ואקססוריז": [],
  "שירותים דיגיטליים": [],
  "תקשורת": ["סלולר", "eSIM", "אינטרנט"],
  "ביטוח": ["ביטוח נסיעות", "ביטוח רכב", "ביטוח בריאות"],
  "כושר": [],
  "מתנות": [],
  "חשמל": [],
  "מים": [],
  "גז": [],
  "ארנונה": [],
  "משיכת מזומן": [],
  "שונות": [],
};
// the colors from the household's Google Sheet (conditional formatting), plus picks for new categories
export const DEFAULT_COLORS = {
  "ביגוד ואקססוריז": "#ffae82", "מים": "#d5f5ff", "שירותים דיגיטליים": "#b2dee1", "ארנונה": "#9fc5e8",
  "שונות": "#f6d9b6", "לבית": "#5d9578", "מתנות": "#de8be0", "בילוי": "#cfc7e6", "ביטוח": "#fce8b2",
  "סופר": "#b7e1cd", "טיפוח": "#ffd4e8", "תחבורה": "#dbffcb", "אוכל בחוץ": "#eba2a2", "כושר": "#a61c00",
  "בריאות": "#6ccaff", "חשמל": "#ffff00", "גז": "#351c75",
  "לינה": "#897dac", "תקשורת": "#7fb3d5", "משיכת מזומן": "#c3c2b7",
};

// only seed defaults on a fresh install (categories are user-managed afterwards)
if (!db.prepare("SELECT value FROM app_meta WHERE key='seeded_v2'").get()) {
  const insCat = db.prepare("INSERT OR IGNORE INTO categories(name, sort) VALUES (?, ?)");
  const insSub = db.prepare("INSERT OR IGNORE INTO subcategories(category, name, sort) VALUES (?, ?, ?)");
  Object.entries(DEFAULT_CATEGORIES).forEach(([c, subs], i) => {
    insCat.run(c, i);
    subs.forEach((s, j) => insSub.run(c, s, j));
  });
  db.prepare("INSERT INTO app_meta(key, value) VALUES ('seeded_v2', '1')").run();
}
if (db.prepare("SELECT 1 FROM categories WHERE name='ביטוחים'").get() && !db.prepare("SELECT 1 FROM categories WHERE name='ביטוח'").get()) {
  db.exec("UPDATE categories SET name='ביטוח' WHERE name='ביטוחים'"); // subcategories follow via ON UPDATE CASCADE
}
{
  const setColor = db.prepare("UPDATE categories SET color = ? WHERE name = ? AND color IS NULL");
  Object.entries(DEFAULT_COLORS).forEach(([c, hex]) => setColor.run(hex, c));
}

// cards are added on import (owner defaults to the last 4 digits; rename under הגדרות)

// v2: חו״ל stops being a category. Abroad spending keeps its trip tag and gets a real category.
// Rows filed under חו״ל go back to review (category cleared); pre-bookings up to 60 days before a
// trip are attached to it. Runs once.
export function migrateAbroad() {
  if (db.prepare("SELECT 1 FROM app_meta WHERE key='abroad_v2'").get()) return null;
  return tx(() => {
    const trips = db.prepare("SELECT * FROM trips").all();
    const rows = db.prepare("SELECT id, purchase_date, trip_id FROM transactions WHERE category = 'חו״ל'").all();
    const upd = db.prepare(
      `UPDATE transactions SET category=NULL, subcategory=NULL, category_source=NULL, needs_review=1,
         trip_id=COALESCE(trip_id, ?), trip_manual=CASE WHEN trip_id IS NULL AND ? IS NOT NULL THEN 1 ELSE trip_manual END
       WHERE id=?`,
    );
    const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
    for (const r of rows) {
      let trip = r.trip_id ? null : trips.find((t) => r.purchase_date >= t.start_date && r.purchase_date <= t.end_date);
      if (!r.trip_id && !trip) {
        trip = trips
          .filter((t) => daysBetween(r.purchase_date, t.start_date) > 0 && daysBetween(r.purchase_date, t.start_date) <= 60)
          .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
      }
      upd.run(trip?.id ?? null, trip?.id ?? null, r.id);
    }
    db.prepare("DELETE FROM rules WHERE category = 'חו״ל'").run();
    db.prepare("DELETE FROM categories WHERE name = 'חו״ל'").run();
    db.prepare("INSERT INTO app_meta(key, value) VALUES ('abroad_v2', '1')").run();
    return rows.length;
  });
}

/** Recomputes merchant keys after the normalization rules change (rules that collide: manual wins). */
export function rekeyMerchants(merchantKey) {
  const VERSION = "2";
  if (db.prepare("SELECT value FROM app_meta WHERE key='merchant_key_v'").get()?.value === VERSION) return;
  tx(() => {
    const upd = db.prepare("UPDATE transactions SET merchant_key=? WHERE id=?");
    db.prepare("SELECT id, merchant FROM transactions").all().forEach((t) => upd.run(merchantKey(t.merchant), t.id));
    const rules = db.prepare("SELECT * FROM rules ORDER BY manual DESC, rowid DESC").all();
    db.exec("DELETE FROM rules");
    const ins = db.prepare(
      `INSERT OR IGNORE INTO rules(merchant_key, sample_name, category, subcategory, votes, is_fixed, manual) VALUES (?,?,?,?,?,?,?)`,
    );
    rules.forEach((r) => ins.run(merchantKey(r.sample_name), r.sample_name, r.category, r.subcategory, r.votes, r.is_fixed, r.manual));
    db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES ('merchant_key_v', ?)").run(VERSION);
  });
}

export function tx(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
