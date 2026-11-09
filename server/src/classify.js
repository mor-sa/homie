import { db } from "./db.js";
import { isOpaqueMerchant } from "./normalize.js";
import { suggestCategories } from "./ai.js";

const getRule = db.prepare("SELECT * FROM rules WHERE merchant_key = ?");
const tripFor = db.prepare("SELECT * FROM trips WHERE ? BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1");

export const categoryNames = () => db.prepare("SELECT name FROM categories ORDER BY sort, name").all().map((r) => r.name);

export function categoryTree() {
  const subs = db.prepare("SELECT * FROM subcategories ORDER BY sort, name").all();
  return categoryNames().map((name) => ({ name, subs: subs.filter((s) => s.category === name).map((s) => s.name) }));
}

// "תחבורה" or "תחבורה > מוניות": the form the AI chooses from
export const SEP = " > ";
export const categoryOptions = () => categoryTree().flatMap((c) => [c.name, ...c.subs.map((s) => c.name + SEP + s)]);
export function splitOption(opt) {
  const [category, subcategory = null] = String(opt).split(SEP);
  return { category, subcategory };
}

function isAmbiguous(rule) {
  const votes = JSON.parse(rule.votes || "{}");
  return !rule.manual && Object.keys(votes).length > 1;
}

/**
 * Decides category for one transaction without AI. Returns fields to merge into the row.
 * A trip is a tag, not a category: purchases abroad still get a real category (food, transport…).
 * Order: fixed-expense rule > cash withdrawal > payment apps > merchant rule > needs AI / human.
 */
export function classifyLocal(t) {
  const rule = getRule.get(t.merchant_key);
  const fixed = rule?.is_fixed || t.txn_type?.includes("הוראת קבע") ? 1 : 0;
  // recurring bills stay out of trips; a trip set by hand is kept
  const trip_id = t.trip_manual ? t.trip_id : fixed ? null : tripFor.get(t.purchase_date)?.id ?? null;
  const base = { trip_id, is_fixed: fixed };

  if (rule?.is_fixed) return { ...base, category: rule.category, subcategory: rule.subcategory, category_source: "rule", needs_review: 0 };

  if (t.txn_type?.includes("משיכת מזומן")) {
    return { ...base, category: "משיכת מזומן", subcategory: null, category_source: "rule", needs_review: 0 };
  }

  if (isOpaqueMerchant(t.merchant)) {
    // BIT etc.: last time's category is only a guess
    return { ...base, category: rule?.category ?? null, subcategory: rule?.subcategory ?? null, category_source: rule ? "rule" : null, needs_review: 1 };
  }

  if (rule) {
    return { ...base, category: rule.category, subcategory: rule.subcategory, category_source: "rule", needs_review: isAmbiguous(rule) ? 1 : 0 };
  }

  return { ...base, category: null, subcategory: null, category_source: null, needs_review: 1, needsAi: true };
}

/** Fill in AI suggestions for rows with needsAi (mutates rows). Suggestions still need approval. */
export async function classifyWithAi(rows) {
  const pending = rows.filter((r) => r.needsAi);
  if (!pending.length) return 0;

  const trips = Object.fromEntries(db.prepare("SELECT id, name FROM trips").all().map((t) => [t.id, t.name]));
  // one suggestion per distinct merchant
  const byKey = new Map();
  pending.forEach((r) => byKey.has(r.merchant_key) || byKey.set(r.merchant_key, r));
  const items = [...byKey.values()].map((r, i) => ({
    id: i,
    merchant: r.merchant,
    amount: r.amount,
    date: r.purchase_date,
    ...(r.orig_currency ? { currency: r.orig_currency } : {}),
    ...(r.trip_id ? { trip: trips[r.trip_id] } : {}),
  }));
  const keys = [...byKey.keys()];

  const examples = db
    .prepare(`SELECT sample_name AS merchant, category || IFNULL(' > ' || subcategory, '') AS category
              FROM rules ORDER BY manual DESC, rowid DESC LIMIT 80`)
    .all();
  const results = await suggestCategories(items, categoryOptions(), examples);

  let n = 0;
  for (const r of pending) {
    const s = results.get(keys.indexOf(r.merchant_key));
    if (!s) continue;
    Object.assign(r, splitOption(s.category));
    r.category_source = "ai";
    r.ai_reason = s.reason + (s.confident ? "" : " (לא בטוח)");
    n++;
  }
  return n;
}

/** Records a human decision as a rule, so the same merchant is automatic next time. */
export function learnRule(merchantKey, sampleName, category, isFixed, { manual = false, subcategory = null } = {}) {
  const existing = getRule.get(merchantKey);
  const votes = JSON.parse(existing?.votes || "{}");
  votes[category] = (votes[category] ?? 0) + 1;
  // a manual decision wins; otherwise majority vote
  const winner = manual ? category : Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  const sub = winner === category ? subcategory : existing?.subcategory ?? null;
  db.prepare(
    `INSERT INTO rules(merchant_key, sample_name, category, subcategory, votes, is_fixed, manual)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(merchant_key) DO UPDATE SET
       category = excluded.category, subcategory = excluded.subcategory, votes = excluded.votes,
       is_fixed = CASE WHEN excluded.manual = 1 THEN excluded.is_fixed ELSE MAX(rules.is_fixed, excluded.is_fixed) END,
       manual = MAX(rules.manual, excluded.manual)`,
  ).run(merchantKey, sampleName, winner, sub, JSON.stringify(votes), isFixed ? 1 : 0, manual ? 1 : 0);
}
