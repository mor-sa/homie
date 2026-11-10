async function req(path, opts = {}) {
  const res = await fetch("/api" + path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  meta: () => req("/meta"),
  dashboard: (month, trips = "include", card = "") => req(`/dashboard?month=${month}&trips=${trips}${card ? `&card=${card}` : ""}`),
  tripDashboard: (id) => req(`/trips/${id}/dashboard`),
  updateTrip: (id, t) => req(`/trips/${id}`, json("PATCH", t)),
  aiSuggest: () => req("/review/ai-suggest", { method: "POST" }),
  addCategory: (c) => req("/categories", json("POST", c)),
  updateCategory: (name, c) => req(`/categories/${encodeURIComponent(name)}`, json("PATCH", c)),
  deleteCategory: (name) => req(`/categories/${encodeURIComponent(name)}`, { method: "DELETE" }),
  addSub: (cat, name) => req(`/categories/${encodeURIComponent(cat)}/subs`, json("POST", { name })),
  renameSub: (cat, sub, name) => req(`/categories/${encodeURIComponent(cat)}/subs/${encodeURIComponent(sub)}`, json("PATCH", { name })),
  deleteSub: (cat, sub) => req(`/categories/${encodeURIComponent(cat)}/subs/${encodeURIComponent(sub)}`, { method: "DELETE" }),
  transactions: (q) => req("/transactions?" + new URLSearchParams(Object.entries(q).filter(([, v]) => v))),
  update: (id, patch) => req(`/transactions/${id}`, json("PATCH", patch)),
  approve: (ids) => req("/review/approve", json("POST", { ids })),
  import: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return req("/import", { method: "POST", body: fd });
  },
  research: (id) => req(`/transactions/${id}/research`, { method: "POST" }),
  researchAll: () => req("/review/research-all", { method: "POST" }),
  trips: () => req("/trips"),
  addTrip: (t) => req("/trips", json("POST", t)),
  deleteTrip: (id) => req(`/trips/${id}`, { method: "DELETE" }),
  setCardOwner: (last4, owner) => req(`/cards/${last4}`, json("PUT", { owner })),
};

// "-₪1,234" for refunds (not "₪-1,234"); toLocaleString on the absolute value avoids bidi marks in the sign
export const ils = (n, digits = 0) => {
  const v = Number(n ?? 0);
  const body = Math.abs(v).toLocaleString("he-IL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (v < 0 && body.replace(/[0.,]/g, "") ? "-" : "") + "₪" + body;
};

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
export const monthLabel = (m, short = false) => {
  if (/^\d{4}$/.test(m)) return `שנת ${m}`;
  const [y, mo] = m.split("-");
  const name = MONTHS[Number(mo) - 1];
  return short ? name.slice(0, 3) + "׳" : `${name} ${y}`;
};
export const dateLabel = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
