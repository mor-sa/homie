import { db } from "./db.js";

const ILS = (n) => "₪" + Math.round(n).toLocaleString("he-IL");
const UNCAT = "לא מסווג";
const shiftMonth = (m, d) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + d, 1)).toISOString().slice(0, 7);
};
const POSTED = "status = 'posted' AND amount IS NOT NULL";
const sum = (arr) => arr.reduce((a, r) => a + r.amount, 0);

export function years() {
  return db
    .prepare(`SELECT substr(purchase_date,1,4) AS year, ROUND(SUM(amount),2) AS total FROM transactions WHERE ${POSTED} GROUP BY year ORDER BY year DESC`)
    .all();
}

export function months() {
  return db
    .prepare(`SELECT substr(purchase_date,1,7) AS month, COUNT(*) AS n, ROUND(SUM(amount),2) AS total
              FROM transactions WHERE ${POSTED} GROUP BY month ORDER BY month DESC`)
    .all();
}

/** The last full month: the dashboard opens on it (falls back to the latest month with data). */
export function defaultMonth() {
  const prev = shiftMonth(new Date().toISOString().slice(0, 7), -1);
  const all = months();
  return all.find((m) => m.month === prev)?.month ?? all.find((m) => m.month < prev)?.month ?? all[0]?.month ?? prev;
}

const colorsMap = () => Object.fromEntries(db.prepare("SELECT name, color FROM categories").all().map((c) => [c.name, c.color]));
const owners = () => Object.fromEntries(db.prepare("SELECT last4, owner FROM cards").all().map((c) => [c.last4, c.owner]));

/** Category totals with sub-category breakdown. `compare` maps extra row-sets to keys (prev, avg3). */
function categoryBreakdown(rows, compare = {}) {
  const colors = colorsMap();
  const out = {};
  const add = (key, r, weight = 1) => {
    const c = r.category ?? UNCAT;
    const cat = (out[c] ??= { category: c, color: colors[c] ?? null, total: 0, prev: 0, avg3: 0, subs: {} });
    cat[key] += r.amount * weight;
    if (r.subcategory) {
      const s = (cat.subs[r.subcategory] ??= { name: r.subcategory, total: 0, prev: 0, avg3: 0 });
      s[key] += r.amount * weight;
    }
  };
  rows.forEach((r) => add("total", r));
  Object.entries(compare).forEach(([key, { rows: rs, weight }]) => rs.forEach((r) => add(key, r, weight)));
  return Object.values(out)
    .map((c) => ({ ...c, subs: Object.values(c.subs).sort((a, b) => b.total - a.total) }))
    .filter((c) => Math.abs(c.total) > 0.005 || Math.abs(c.prev) > 0.005 || Math.abs(c.avg3) > 0.005)
    .sort((a, b) => b.total - a.total || b.prev - a.prev);
}

function merchantsOf(rows) {
  return Object.values(
    rows.reduce((a, r) => {
      const m = (a[r.merchant_key] ??= { merchant: r.merchant, total: 0, count: 0, category: r.category });
      m.total += r.amount;
      m.count++;
      return a;
    }, {}),
  );
}

// `month` is "YYYY-MM" for a month view or "YYYY" for a year view
export function dashboard(month, { excludeTrips = false } = {}) {
  const isYear = /^\d{4}$/.test(month);
  const tripFilter = excludeTrips ? " AND trip_id IS NULL" : "";
  const inMonth = db.prepare(`SELECT * FROM transactions WHERE ${POSTED}${tripFilter} AND purchase_date LIKE ? || '%'`);
  const rows = inMonth.all(month);

  const prevMonth = isYear ? String(Number(month) - 1) : shiftMonth(month, -1);
  const prevRows = isYear ? [inMonth.all(prevMonth)] : [1, 2, 3].map((d) => inMonth.all(shiftMonth(month, -d)));
  const monthsWithData = prevRows.filter((r) => r.length).length || 1;

  const byCategory = categoryBreakdown(rows, {
    prev: { rows: prevRows[0], weight: 1 },
    avg3: { rows: prevRows.flat(), weight: 1 / monthsWithData },
  });

  const total = sum(rows);
  const fixed = sum(rows.filter((r) => r.is_fixed));
  const trip = sum(rows.filter((r) => r.trip_id));
  const own = owners();
  const byCard = Object.entries(rows.reduce((a, r) => ((a[r.card ?? "?"] = (a[r.card ?? "?"] ?? 0) + r.amount), a), {}))
    .map(([card, t]) => ({ card, owner: own[card] ?? card, total: t }));

  // 12-month trend (always computed with trips split out, so the bar can show both parts)
  const trendRows = db
    .prepare(
      `SELECT substr(purchase_date,1,7) AS month, SUM(amount) AS total,
              SUM(CASE WHEN trip_id IS NOT NULL THEN amount ELSE 0 END) AS trip
       FROM transactions WHERE ${POSTED} AND purchase_date >= ? AND purchase_date < ?
       GROUP BY month ORDER BY month`,
    )
    .all(isYear ? `${month}-01-01` : shiftMonth(month, -11) + "-01", isYear ? `${Number(month) + 1}-01-01` : shiftMonth(month, 1) + "-01");
  const trend = trendRows.map((t) => (excludeTrips ? { ...t, total: t.total - t.trip, trip: 0 } : t));

  const merchants = merchantsOf(rows);
  const topMerchants = [...merchants].sort((a, b) => b.total - a.total).slice(0, 8);
  const frequent = merchants.filter((m) => m.count >= 3).sort((a, b) => b.count - a.count).slice(0, 5);
  const largest = [...rows].sort((a, b) => b.amount - a.amount).slice(0, 5);

  const weekday = Array.from({ length: 7 }, () => 0);
  rows.filter((r) => !r.trip_id && !r.is_fixed).forEach((r) => (weekday[new Date(r.purchase_date).getUTCDay()] += r.amount));

  const insights = [];
  const avgTotal = byCategory.reduce((a, c) => a + c.avg3, 0);

  if (isYear && trend.length) {
    const avgMonth = total / trend.length;
    const top = [...trend].sort((a, b) => b.total - a.total)[0];
    const low = [...trend].sort((a, b) => a.total - b.total)[0];
    insights.push({ tone: "info", text: `ממוצע חודשי: ${ILS(avgMonth)} (${trend.length} חודשים עם נתונים)` });
    if (trend.length > 1) {
      insights.push({ tone: "warn", text: `החודש היקר ביותר: ${top.month.slice(5)}/${top.month.slice(0, 4)}, ${ILS(top.total)}` + (top.trip > 0 ? ` (מתוכם ${ILS(top.trip)} בטיולים)` : "") });
      insights.push({ tone: "good", text: `החודש הזול ביותר: ${low.month.slice(5)}/${low.month.slice(0, 4)}, ${ILS(low.total)}` });
    }
    byCategory.filter((c) => c.category !== UNCAT).slice(0, 3).forEach((c) =>
      insights.push({ tone: "info", text: `${c.category}: ${ILS(c.total)} השנה, ${ILS(c.total / trend.length)} בחודש בממוצע` }));
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!isYear && today.startsWith(month)) {
    const day = Number(today.slice(8, 10));
    const daysIn = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
    const projected = ((total - fixed) / day) * daysIn + fixed;
    insights.push({
      tone: avgTotal && projected > avgTotal * 1.1 ? "warn" : "info",
      text: `בקצב הנוכחי החודש ייסגר בערך על ${ILS(projected)}` + (avgTotal ? ` (ממוצע 3 חודשים: ${ILS(avgTotal)})` : ""),
    });
  }

  if (!isYear && prevRows.some((r) => r.length)) {
    const real = byCategory.filter((c) => c.category !== UNCAT);
    real
      .filter((c) => c.avg3 > 0 && c.total - c.avg3 > 250 && c.total > c.avg3 * 1.3)
      .slice(0, 3)
      .forEach((c) => {
        const topSub = c.subs.find((s) => s.total - s.avg3 > 150);
        insights.push({
          tone: "warn",
          text: `${c.category}: ${ILS(c.total)}, יותר ב-${Math.round((c.total / c.avg3 - 1) * 100)}% מהממוצע (${ILS(c.avg3)})` +
            (topSub ? `, בעיקר ${topSub.name}` : ""),
        });
      });
    real
      .filter((c) => c.avg3 > 300 && c.total < c.avg3 * 0.6)
      .slice(0, 2)
      .forEach((c) => insights.push({ tone: "good", text: `${c.category}: ${ILS(c.total)}, פחות ב-${Math.round((1 - c.total / c.avg3) * 100)}% מהממוצע` }));
  }

  if (!isYear) frequent.slice(0, 2).forEach((m) => insights.push({ tone: "info", text: `${m.merchant}: ${m.count} ביקורים החודש, ${ILS(m.total)} בסך הכל` }));

  if (!excludeTrips && trip > 0) {
    insights.push({ tone: "info", text: `${ILS(trip)} (${Math.round((trip / total) * 100)}%) מההוצאות ${isYear ? "השנה" : "החודש"} היו בטיולים. בלי טיולים: ${ILS(total - trip)}` });
  }

  const recurring = isYear ? [] : db
    .prepare(
      `SELECT merchant_key, MAX(merchant) AS merchant, COUNT(DISTINCT substr(purchase_date,1,7)) AS months,
              AVG(amount) AS avg, MIN(amount) AS lo, MAX(amount) AS hi, MAX(is_fixed) AS fixed
       FROM transactions WHERE ${POSTED} AND purchase_date >= ? AND purchase_date < ?
       GROUP BY merchant_key HAVING months >= 3 AND fixed = 0 AND lo > 0 AND hi <= lo * 1.15`,
    )
    .all(shiftMonth(month, -3) + "-01", shiftMonth(month, 1) + "-01");
  if (!isYear) recurring.forEach((r) => insights.push({ tone: "info", text: `${r.merchant} חוזר כל חודש (~${ILS(r.avg)}). אולי כדאי לסמן כהוצאה קבועה?` }));

  const subscriptions = db
    .prepare(
      `SELECT MAX(merchant) AS merchant, category, SUM(amount) AS total FROM transactions
       WHERE ${POSTED} AND is_fixed = 1 AND purchase_date LIKE ? || '%' GROUP BY merchant_key ORDER BY total DESC`,
    )
    .all(month);

  return {
    month,
    period: isYear ? "year" : "month",
    prevMonth,
    monthsInPeriod: isYear ? trend.length : 1,
    excludeTrips,
    kpis: {
      total, fixed, variable: total - fixed, trip, count: rows.length,
      prevTotal: sum(prevRows[0]), avg3Total: avgTotal, byCard,
      needsReview: db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE needs_review = 1 AND status = 'posted'").get().n,
    },
    byCategory, trend, topMerchants, largest, weekday, subscriptions, insights,
  };
}

export function tripDashboard(id) {
  const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(id);
  if (!trip) throw new Error("not found");
  const rows = db.prepare(`SELECT * FROM transactions WHERE ${POSTED} AND trip_id = ? ORDER BY purchase_date`).all(id);
  const days = Math.round((Date.parse(trip.end_date) - Date.parse(trip.start_date)) / 86400000) + 1;
  const total = sum(rows);
  const before = rows.filter((r) => r.purchase_date < trip.start_date);
  const own = owners();

  // daily series across the trip days (bookings paid before the trip shown separately)
  const daily = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.parse(trip.start_date) + i * 86400000).toISOString().slice(0, 10);
    daily.push({ date: d, total: sum(rows.filter((r) => r.purchase_date === d)) });
  }

  const currencies = Object.values(
    rows.reduce((a, r) => {
      const c = r.orig_currency ?? "ILS";
      const x = (a[c] ??= { currency: c, total: 0, orig: 0, count: 0 });
      x.total += r.amount;
      x.orig += r.orig_amount ?? r.amount;
      x.count++;
      return a;
    }, {}),
  ).sort((a, b) => b.total - a.total);

  const allTrips = db
    .prepare(
      `SELECT t.id, t.name, t.start_date, t.end_date, IFNULL(SUM(x.amount),0) AS total, COUNT(x.id) AS n
       FROM trips t LEFT JOIN transactions x ON x.trip_id = t.id AND x.status='posted'
       GROUP BY t.id ORDER BY t.start_date DESC`,
    )
    .all()
    .map((t) => {
      const d = Math.round((Date.parse(t.end_date) - Date.parse(t.start_date)) / 86400000) + 1;
      return { ...t, days: d, perDay: t.total / d };
    });

  return {
    trip,
    days,
    total,
    perDay: total / days,
    prepaid: sum(before),
    prepaidCount: before.length,
    unreviewed: rows.filter((r) => r.needs_review).length,
    byCard: Object.entries(rows.reduce((a, r) => ((a[r.card ?? "?"] = (a[r.card ?? "?"] ?? 0) + r.amount), a), {}))
      .map(([card, t]) => ({ card, owner: own[card] ?? card, total: t })),
    byCategory: categoryBreakdown(rows),
    daily,
    currencies,
    topMerchants: merchantsOf(rows).sort((a, b) => b.total - a.total).slice(0, 8),
    largest: [...rows].sort((a, b) => b.amount - a.amount).slice(0, 5),
    allTrips,
  };
}
