import { readXlsx } from "./xlsx.js";
import { cellText, excelDate, num } from "../normalize.js";

// Reads an uploaded workbook and returns { kind, rows } where rows are normalized transactions.
// kind 'cal'     = raw Cal (כאל) "פירוט עסקאות וזיכויים" export
// kind 'history' = the existing Google Sheets workbook (one tab per month, manually categorized)
export async function parseWorkbook(buffer) {
  const sheets = readXlsx(buffer);

  // Some exports contain the same sheet twice; skip exact duplicates.
  const seen = new Set();
  const unique = sheets.filter((s) => {
    const sig = JSON.stringify(s.grid);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  for (const s of unique) if (findHeader(s.grid, ["שם בית עסק"])) return { kind: "cal", rows: unique.flatMap(parseCal) };
  for (const s of unique) if (findHeader(s.grid, ["עסק", "קטגוריה"])) return { kind: "history", rows: unique.flatMap(parseHistory) };
  throw new Error("לא זוהה פורמט הקובץ. נתמכים: ייצוא 'פירוט עסקאות' מכאל, או קובץ ההוצאות מגוגל שיטס.");
}

const clean = (v) => cellText(v).replace(/\s+/g, " ").trim();

function findHeader(grid, needles) {
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const cells = (grid[r] ?? []).map(clean);
    if (needles.every((n) => cells.some((c) => c === n || c.includes(n)))) return { r, cells };
  }
  return null;
}

const col = (cells, ...parts) => cells.findIndex((c) => parts.every((p) => c.includes(p)));

function parseCal({ grid }) {
  const h = findHeader(grid, ["שם בית עסק"]);
  if (!h) return [];
  const title = grid.slice(0, h.r).flat().map(clean).join(" ");
  const card = title.match(/(\d{4})\s*$/)?.[1] ?? title.match(/כרטיס\D*(\d{4})/)?.[1] ?? null;

  const c = {
    date: col(h.cells, "תאריך"),
    merchant: col(h.cells, "שם בית עסק"),
    amount: col(h.cells, "סכום"),
    charge: col(h.cells, "מועד"),
    type: col(h.cells, "סוג"),
    notes: col(h.cells, "הערות"),
  };

  const out = [];
  for (let r = h.r + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const date = excelDate(row[c.date]);
    const merchant = clean(row[c.merchant]);
    if (!date || !merchant) continue; // totals / footer lines
    const note = clean(row[c.notes]);
    const amount = num(row[c.amount]);
    const fx = note.match(/סכום העסקה הוא\s*([\d.,]+)\s*([A-Z$€£]{1,3})/);
    out.push({
      card,
      purchase_date: date,
      charge_date: excelDate(row[c.charge]),
      merchant,
      amount,
      orig_amount: fx ? num(fx[1]) : null,
      orig_currency: fx ? (fx[2] === "$" ? "USD" : fx[2]) : null,
      txn_type: clean(row[c.type]) || null,
      status: amount == null || note.includes("בקליטה") ? "pending" : "posted",
    });
  }
  return out;
}

function parseHistory({ grid }) {
  const h = findHeader(grid, ["עסק", "קטגוריה"]);
  if (!h) return [];
  const c = {
    desc: col(h.cells, "תיאור"),
    merchant: h.cells.findIndex((x) => x === "עסק"),
    amount: col(h.cells, "סכום"),
    date: col(h.cells, "תאריך"),
    fixed: col(h.cells, "קבועה"),
    card: col(h.cells, "ספרות"),
    category: col(h.cells, "קטגוריה"),
  };
  const out = [];
  for (let r = h.r + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const date = excelDate(row[c.date]);
    const amount = num(row[c.amount]);
    const merchant = clean(row[c.merchant]);
    if (!date || amount == null || !merchant) continue;
    const card = clean(row[c.card]).replace(/\.0$/, "") || null;
    out.push({
      card,
      purchase_date: date,
      charge_date: null,
      merchant,
      amount,
      txn_type: null,
      status: "posted",
      category: clean(row[c.category]) || null,
      is_fixed: clean(row[c.fixed]) === "כן" ? 1 : 0,
      note: c.desc >= 0 ? clean(row[c.desc]) || null : null,
    });
  }
  return out;
}
