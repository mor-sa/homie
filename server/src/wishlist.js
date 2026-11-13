// Wishlist: things we'd like to buy. Each item can have a photo; the smart search (ai.js findProducts)
// identifies it from the photo and looks for the same or similar items sold in Israel, with prices.
// Photos live next to the database in server/data/wishlist/ (gitignored, like the rest of the data).
import { mkdirSync, readFileSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import multer from "multer";
import { db } from "./db.js";
import { aiEnabled, findProducts } from "./ai.js";

db.exec(`
CREATE TABLE IF NOT EXISTS wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  note TEXT,
  url TEXT,                 -- where we saw it
  price REAL,               -- price we saw, if any
  photo TEXT,               -- file name in PHOTO_DIR
  status TEXT NOT NULL DEFAULT 'want',   -- want | bought
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  bought_at TEXT,
  search TEXT,              -- JSON of the last smart search
  searched_at TEXT
);
`);

const DB_PATH = resolve(process.env.DB_PATH ?? new URL("../data/expenses.db", import.meta.url).pathname);
const PHOTO_DIR = join(dirname(DB_PATH), "wishlist");
mkdirSync(PHOTO_DIR, { recursive: true });

const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MEDIA = Object.fromEntries(Object.entries(TYPES).map(([t, e]) => [e, t]));
const SAFE_NAME = /^[a-z0-9-]+\.(jpg|png|webp|gif)$/;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function savePhoto(file) {
  const ext = TYPES[file.mimetype];
  if (!ext) throw new Error("אפשר להעלות תמונה מסוג JPG, PNG, WEBP או GIF");
  const name = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.${ext}`;
  writeFileSync(join(PHOTO_DIR, name), file.buffer);
  return name;
}
function removePhoto(name) {
  if (name && SAFE_NAME.test(name) && existsSync(join(PHOTO_DIR, name))) unlinkSync(join(PHOTO_DIR, name));
}

const row = (r) => r && { ...r, search: r.search ? JSON.parse(r.search) : null };
const get = (id) => row(db.prepare("SELECT * FROM wishlist WHERE id=?").get(id));
const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function registerWishlistRoutes(app, wrap) {
  app.get("/api/wishlist", wrap(() =>
    db.prepare("SELECT * FROM wishlist ORDER BY status = 'bought', COALESCE(bought_at, created_at) DESC").all().map(row)));

  app.get("/api/wishlist/photos/:name", (req, res) => {
    const name = req.params.name;
    if (!SAFE_NAME.test(name) || !existsSync(join(PHOTO_DIR, name))) return res.status(404).end();
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(join(PHOTO_DIR, name));
  });

  // multipart: title, note, url, price, photo (file)
  app.post("/api/wishlist", upload.single("photo"), wrap((req) => {
    const title = text(req.body.title);
    if (!title && !req.file) throw new Error("חסר שם או תמונה");
    const photo = req.file ? savePhoto(req.file) : null;
    const id = db.prepare("INSERT INTO wishlist(title, note, url, price, photo) VALUES (?,?,?,?,?)")
      .run(title ?? "פריט מתמונה", text(req.body.note), text(req.body.url), num(req.body.price), photo).lastInsertRowid;
    return get(id);
  }));

  // multipart too, so the photo can be replaced; remove_photo=1 drops it
  app.patch("/api/wishlist/:id", upload.single("photo"), wrap((req) => {
    const r = get(req.params.id);
    if (!r) throw new Error("not found");
    const b = req.body;
    let photo = r.photo;
    if (req.file || b.remove_photo === "1") {
      removePhoto(r.photo);
      photo = req.file ? savePhoto(req.file) : null;
    }
    const status = b.status === "bought" || b.status === "want" ? b.status : r.status;
    db.prepare("UPDATE wishlist SET title=?, note=?, url=?, price=?, photo=?, status=?, bought_at=? WHERE id=?").run(
      b.title !== undefined ? text(b.title) ?? r.title : r.title,
      b.note !== undefined ? text(b.note) : r.note,
      b.url !== undefined ? text(b.url) : r.url,
      b.price !== undefined ? num(b.price) : r.price,
      photo, status,
      status === "bought" ? r.bought_at ?? new Date().toISOString().slice(0, 10) : null,
      r.id,
    );
    return get(r.id);
  }));

  app.delete("/api/wishlist/:id", wrap((req) => {
    const r = get(req.params.id);
    if (!r) throw new Error("not found");
    removePhoto(r.photo);
    db.prepare("DELETE FROM wishlist WHERE id=?").run(r.id);
    return { ok: true };
  }));

  // Smart search: identify from the photo and find it (or similar) in Israeli stores
  app.post("/api/wishlist/:id/search", wrap(async (req) => {
    if (!aiEnabled()) throw new Error("החיפוש החכם דורש ANTHROPIC_API_KEY בקובץ server/.env");
    const r = get(req.params.id);
    if (!r) throw new Error("not found");
    const ext = r.photo?.split(".").pop();
    const image = r.photo ? { media_type: MEDIA[ext], data: readFileSync(join(PHOTO_DIR, r.photo)).toString("base64") } : null;
    const result = await findProducts({ title: r.title, note: r.note, url: r.url, price: r.price, image });
    db.prepare("UPDATE wishlist SET search=?, searched_at=datetime('now') WHERE id=?").run(JSON.stringify(result), r.id);
    // a photo-only item gets the name the search identified
    if (r.title === "פריט מתמונה" && result.name) db.prepare("UPDATE wishlist SET title=? WHERE id=?").run(result.name, r.id);
    return get(r.id);
  }));
}
