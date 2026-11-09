import { db, tx } from "./db.js";
import { merchantKey } from "./normalize.js";
import { parseWorkbook } from "./importers/index.js";
import { readCategoryColors } from "./importers/xlsx.js";
import { classifyLocal, classifyWithAi, learnRule, categoryNames } from "./classify.js";

const countSame = db.prepare(
  "SELECT COUNT(*) AS n FROM transactions WHERE status='posted' AND IFNULL(card,'') = IFNULL(?, '') AND purchase_date = ? AND amount = ?",
);

const insert = db.prepare(`
  INSERT OR IGNORE INTO transactions
    (dedupe_key, card, purchase_date, charge_date, merchant, merchant_key, amount, orig_amount, orig_currency,
     txn_type, sector, status, category, subcategory, category_source, ai_reason, needs_review, is_fixed, note, trip_id, import_id)
  VALUES
    (:dedupe_key, :card, :purchase_date, :charge_date, :merchant, :merchant_key, :amount, :orig_amount, :orig_currency,
     :txn_type, :sector, :status, :category, :subcategory, :category_source, :ai_reason, :needs_review, :is_fixed, :note, :trip_id, :import_id)`);

const COLS = [
  "card", "purchase_date", "charge_date", "merchant", "merchant_key", "amount", "orig_amount", "orig_currency",
  "txn_type", "sector", "status", "category", "subcategory", "category_source", "ai_reason", "needs_review", "is_fixed", "note", "trip_id",
];

export async function importFile(filename, buffer) {
  const { kind, rows } = await parseWorkbook(buffer);
  rows.forEach((r) => (r.merchant_key = merchantKey(r.merchant)));

  // Dedupe: statements overlap, and history rows overlap with the first card exports.
  // A row is new if this file has more (card, date, amount) occurrences than the DB already holds.
  const seenInFile = new Map();
  const fresh = [];
  let duplicates = 0;
  for (const r of rows) {
    if (r.status === "pending") {
      fresh.push(r);
      continue;
    }
    const k = `${r.card}|${r.purchase_date}|${r.amount}`;
    const nth = (seenInFile.get(k) ?? 0) + 1;
    seenInFile.set(k, nth);
    r.dedupe_key = `${k}|${nth}`;
    if (nth <= countSame.get(r.card, r.purchase_date, r.amount).n) duplicates++;
    else fresh.push(r);
  }

  if (kind === "history") {
    // Already categorized by hand: learn rules from every row (including duplicates), import new rows as-is.
    // Categories that no longer exist (e.g. the old חו״ל) go to review instead.
    // Categories used in the sheet but missing here are created (with the sheet's color), except
    // trip-like ones: abroad spending is now a trip tag plus a real category.
    const TRIP_LIKE = new Set(["חו״ל", "חופשה"]);
    const colors = readCategoryColors(buffer);
    tx(() => {
      const addCat = db.prepare("INSERT OR IGNORE INTO categories(name, sort, color) VALUES (?, 100, ?)");
      const setColor = db.prepare("UPDATE categories SET color = ? WHERE name = ? AND color IS NULL");
      new Set(rows.map((r) => r.category).filter((c) => c && !TRIP_LIKE.has(c))).forEach((c) => addCat.run(c, colors[c] ?? null));
      Object.entries(colors).forEach(([c, hex]) => setColor.run(hex, c));
    });
    const known = new Set(categoryNames());
    rows.forEach((r) => known.has(r.category) || (r.category = null));
    tx(() => rows.forEach((r) => r.category && learnRule(r.merchant_key, r.merchant, r.category, r.is_fixed)));
    fresh.forEach((r) => {
      const { trip_id } = classifyLocal(r);
      Object.assign(r, { trip_id, category_source: r.category ? "history" : null, needs_review: r.category ? 0 : 1, needsAi: !r.category });
    });
  } else {
    fresh.forEach((r) => Object.assign(r, classifyLocal(r)));
  }
  await classifyWithAi(fresh.filter((r) => r.status === "posted"));

  const cards = [...new Set(rows.map((r) => r.card).filter(Boolean))];
  return tx(() => {
    const { lastInsertRowid: importId } = db
      .prepare("INSERT INTO imports(filename, kind) VALUES (?, ?)")
      .run(filename, kind);

    const addCard = db.prepare("INSERT OR IGNORE INTO cards(last4, owner) VALUES (?, ?)");
    cards.forEach((c) => addCard.run(c, c));

    // pending rows are a snapshot: replace the previous snapshot for these cards
    for (const c of cards) db.prepare("DELETE FROM transactions WHERE status='pending' AND card = ?").run(c);

    let added = 0;
    fresh.forEach((r, i) => {
      if (r.status === "pending") r.dedupe_key = `pending|${r.card}|${r.purchase_date}|${r.merchant_key}|${importId}|${i}`;
      const params = Object.fromEntries(COLS.map((c) => [c, r[c] ?? null]));
      params.needs_review ??= 0;
      params.is_fixed ??= 0;
      added += insert.run({ ...params, dedupe_key: `${kind}|${r.dedupe_key}`, import_id: importId }).changes;
    });
    db.prepare("UPDATE imports SET added = ? WHERE id = ?").run(added, importId);

    return {
      kind,
      cards,
      total: rows.length,
      added,
      duplicates,
      pending: fresh.filter((r) => r.status === "pending").length,
      needsReview: fresh.filter((r) => r.needs_review).length,
      bySource: fresh.reduce((a, r) => ((a[r.category_source ?? "none"] = (a[r.category_source ?? "none"] ?? 0) + 1), a), {}),
    };
  });
}
