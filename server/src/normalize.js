// Merchant names arrive in inconsistent forms: "קניון CARREFOUR" in a sheet vs "CARREFOUR קניון"
// in a card export (word order flips with RTL copy/paste), or "Spotify P12345ABCD" with a changing id.
// The key is order-independent and drops ids, legal suffixes and punctuation.
const NOISE = new Set(["בע״מ", 'בע"מ', "בעמ", "בע?מ", "בכע״מ", "בכעמ", "ltd", "co", "inc", "limited", "com"]);

// payment-processor prefixes in front of the real merchant: "BKG*BOOKING.COM", "PAYPAL *EXPEDIA.COM", "SQ *CAFE"
const PROCESSOR = /^(bkg|paypal|pp|sq|sp|sumup|zettle|izettle|tst|dnh|google|apple\.com\/bill)\s*[*_]\s*/i;

export function merchantKey(name) {
  return String(name ?? "")
    .replace(PROCESSOR, "")
    .toLowerCase()
    .replace(/[״"'`׳?]/g, "")
    .replace(/[*#/\\()\-_.,:|]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t) && !/\d/.test(t) && t.length > 1)
    .sort()
    .join(" ") || String(name ?? "").trim().toLowerCase();
}

// Payment apps: the merchant name says nothing about the purchase, so these always need a human.
const OPAQUE = [/^bit\b/i, /\bbit\b/i, /paybox/i, /^pepper pay/i];
export const isOpaqueMerchant = (name) => OPAQUE.some((re) => re.test(name));

export function excelDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/); // DD/MM/YYYY
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(s)) return excelDate(Number(s));
  return null;
}

export function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[₪,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// exceljs cell values can be rich text / formula objects
export function cellText(v) {
  if (v == null) return "";
  if (typeof v === "object" && !(v instanceof Date)) {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return cellText(v.result);
    if (v.text) return String(v.text);
  }
  return String(v);
}
export function cellValue(v) {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return v.result;
    if (v.richText) return cellText(v);
  }
  return v;
}
