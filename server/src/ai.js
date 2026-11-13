import Anthropic from "@anthropic-ai/sdk";

// Only merchants that no rule or trip covers reach this. One request per import.
const MODEL = process.env.AI_MODEL ?? "claude-opus-5-5";
let client = null;
const getClient = () => (client ??= new Anthropic());

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * Looks a single merchant up on the web and proposes a category. The result is only a
 * suggestion: the caller keeps the transaction in review until a person approves it.
 * @returns { category, confident, reason, sources: [{url, title}] } or null
 */
export async function researchMerchant(t, categories, examples) {
  if (!aiEnabled()) throw new Error("חיפוש ברשת דורש ANTHROPIC_API_KEY בקובץ server/.env");

  const submit = {
    name: "submit_category",
    description: "Submit the final category for the transaction. Call exactly once, after researching.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["category", "confident", "business_description", "reason"],
      properties: {
        category: { type: "string", enum: categories },
        confident: { type: "boolean" },
        business_description: { type: "string", description: "What this business is, in Hebrew, up to 12 words" },
        reason: { type: "string", description: "Why this category, in Hebrew, up to 12 words" },
      },
    },
  };

  const ctx = t.context ?? {};
  const prompt = `זוג בישראל רוצה לדעת מה זה החיוב הזה בפירוט כרטיס האשראי שלהם, כדי לסווג את ההוצאה.

שם העסק כפי שמופיע בפירוט: ${t.merchant}
סכום: ₪${t.amount}${t.orig_amount != null ? ` (במקור ${t.orig_amount}${t.orig_currency && t.orig_currency !== "מט״ח" ? " " + t.orig_currency : " במטבע זר"})` : ""}
תאריך: ${t.purchase_date}
${t.sector ? `הענף לפי חברת האשראי: ${t.sector}\n` : ""}${t.note ? `הערה שהם כתבו: ${t.note}\n` : ""}${ctx.trip ? `העסקה שייכת לטיול "${ctx.trip.name}" (${ctx.trip.start_date} עד ${ctx.trip.end_date}). חפש את העסק במדינה של הטיול, וסווג לפי מה שנקנה (מסעדה, מלון, תחבורה…), לא לפי המדינה.\n` : ""}${ctx.sameDay?.length ? `עסקאות אחרות באותו יום (עוזרות להבין איפה הם היו): ${ctx.sameDay.join("; ")}\n` : ""}
חפש ברשת מה העסק הזה. שמות בפירוטי אשראי לרוב מקוצרים, או שם החברה הרשמית ולא שם המותג, ולפעמים כוללים מספר סניף או קוד מדינה בסוף. ואז קרא ל-submit_category.
קטגוריות אפשריות (קטגוריה, או "קטגוריה > תת-קטגוריה" כשיש התאמה ברורה): ${categories.join(", ")}
דוגמאות לאיך הם מסווגים: ${examples.slice(0, 30).map((e) => `${e.merchant} → ${e.category}`).join("; ")}
אם גם אחרי חיפוש לא ברור, בחר את הקטגוריה הסבירה ביותר וסמן confident=false.`;

  // abroad, don't bias search results toward Israel
  const search = { type: "web_search_20260209", name: "web_search", max_uses: 4, ...(ctx.trip ? {} : { user_location: { type: "approximate", country: "IL" } }) };
  const tools = [search, submit];
  const messages = [{ role: "user", content: prompt }];
  const sources = new Map();

  for (let turn = 0; turn < 5; turn++) {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      tools,
      messages,
    });
    if (response.stop_reason === "refusal") throw new Error("הבקשה נדחתה על ידי המודל");

    for (const block of response.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        block.content.forEach((r) => r.url && sources.set(r.url, { url: r.url, title: r.title }));
      }
    }
    const call = response.content.find((b) => b.type === "tool_use" && b.name === "submit_category");
    if (call) {
      const input = typeof call.input === "string" ? JSON.parse(call.input) : call.input;
      if (!categories.includes(input.category)) throw new Error("המודל החזיר קטגוריה לא מוכרת");
      return { ...input, sources: [...sources.values()].slice(0, 3) };
    }
    if (response.stop_reason === "pause_turn") {
      // server-side search loop paused: resend so it resumes
      messages.splice(1, messages.length - 1, { role: "assistant", content: response.content });
      continue;
    }
    // ended without calling the tool: ask once more
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: "קרא עכשיו ל-submit_category." });
  }
  throw new Error("לא התקבלה תשובה מהחיפוש");
}

/**
 * @param items     [{ id, merchant, amount, date, orig_currency }]
 * @param categories string[]
 * @param examples  [{ merchant, category }] few-shot from the household's own rules
 * @returns Map<id, { category, confident, reason }>
 */
export async function suggestCategories(items, categories, examples) {
  if (!items.length || !aiEnabled()) return new Map();

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "category", "confident", "reason"],
          properties: {
            id: { type: "integer" },
            category: { type: "string", enum: categories },
            confident: { type: "boolean" },
            reason: { type: "string" },
          },
        },
      },
    },
  };

  const prompt = `אתה עוזר לזוג בישראל לסווג עסקאות כרטיס אשראי לקטגוריות של תקציב הבית.

קטגוריות אפשריות (אפשר לבחור קטגוריה, או "קטגוריה > תת-קטגוריה" כשיש התאמה ברורה): ${categories.join(", ")}

עסקאות עם שדה trip נעשו בטיול בחו״ל: סווג לפי מה שנקנה (מסעדה, מלון, תחבורה…), לא לפי המדינה.

כך הם סיווגו עסקים בעבר (השתמש בזה כדי להבין את ההעדפות שלהם):
${examples.map((e) => `- ${e.merchant} → ${e.category}`).join("\n")}

סווג כל אחת מהעסקאות הבאות. סמן confident=false אם שם העסק לא מספיק כדי לדעת (למשל אפליקציות תשלום, שמות חברה כלליים). reason: עד 8 מילים בעברית.

${JSON.stringify(items)}`;

  try {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      console.warn("AI classification stopped:", response.stop_reason);
      return new Map();
    }
    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const { results = [] } = JSON.parse(text);
    return new Map(results.map((r) => [r.id, r]));
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.warn("AI disabled: invalid API key");
    else if (e instanceof Anthropic.RateLimitError) console.warn("AI rate limited; leaving for manual review");
    else if (e instanceof Anthropic.APIError) console.warn("AI error:", e.status, e.message);
    else console.warn("AI classification failed:", e.message);
    return new Map();
  }
}

/**
 * Wishlist smart search: identifies the item (from the photo and/or its name) and searches the web for the
 * same item or close alternatives that can be bought in Israel, with prices in shekels. Links are kept only
 * if they come from a page the search actually returned, so a made-up URL never reaches the list.
 * @param item { title, note, url, price, image: { media_type, data } | null }
 * @returns { name, identified, query, results: [{ title, store, price, url, match, note }], searched_with_photo }
 */
export async function findProducts(item) {
  const submit = {
    name: "submit_products",
    description: "Submit the products found. Call exactly once, after searching.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "identified", "query", "results"],
      properties: {
        name: { type: "string", description: "Short Hebrew name for the item, 2-5 words (e.g. 'כורסת קטיפה ירוקה')" },
        identified: { type: "string", description: "What the item is, in Hebrew, up to 25 words: type, style, material, color, brand/model if recognizable" },
        query: { type: "string", description: "The best search phrase you found for this item (Hebrew or English)" },
        results: {
          type: "array",
          description: "3-8 offers, most similar first",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "store", "price", "url", "match", "note"],
            properties: {
              title: { type: "string", description: "Product name as the store lists it" },
              store: { type: "string", description: "Store name" },
              price: { type: ["number", "null"], description: "Price in ILS as shown on the page; null if not seen" },
              url: { type: "string", description: "Product page URL, exactly as it appeared in the search results" },
              match: { type: "string", enum: ["same", "very_similar", "similar"] },
              note: { type: "string", description: "Hebrew, up to 12 words: how it differs, sale, shipping, etc. Empty if nothing" },
            },
          },
        },
      },
    },
  };

  const prompt = `זוג בישראל רוצה לקנות את הפריט הזה${item.image ? " (בתמונה)" : ""}.
${item.title && item.title !== "פריט מתמונה" ? `השם שהם נתנו: ${item.title}\n` : ""}${item.note ? `הערות שלהם: ${item.note}\n` : ""}${item.url ? `איפה ראו אותו: ${item.url}\n` : ""}${item.price != null ? `מחיר שראו: ₪${item.price}\n` : ""}
1. זהה מה הפריט: סוג, סגנון, חומר, צבע, ומותג ודגם אם אפשר לזהות.
2. חפש ברשת איפה אפשר לקנות אותו בישראל: חנויות ישראליות, או אתרים בינלאומיים ששולחים לישראל. אם המוצר המדויק לא נמצא, חפש חלופות דומות מאוד במראה ובשימוש. כדאי לחפש גם בעברית וגם באנגלית.
3. לכל תוצאה צריך מחיר בשקלים כפי שמופיע בדף. אם לא ראית מחיר, price=null. אל תנחש מחירים.
4. השתמש רק בכתובות של דפי מוצר שראית בתוצאות החיפוש. אל תמציא כתובות.
5. קרא ל-submit_products עם 3 עד 8 תוצאות, הדומות ביותר קודם, ועדיף כמה חנויות שונות.`;

  const content = [{ type: "text", text: prompt }];
  if (item.image) content.unshift({ type: "image", source: { type: "base64", ...item.image } });

  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: 8, user_location: { type: "approximate", country: "IL" } },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
    submit,
  ];
  const messages = [{ role: "user", content }];
  const seen = new Set(); // URLs that search or fetch returned
  const collect = (block) => {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) block.content.forEach((r) => r.url && seen.add(r.url));
    if (block.type === "web_fetch_tool_result" && block.content?.url) seen.add(block.content.url);
  };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };

  for (let turn = 0; turn < 6; turn++) {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      tools,
      messages,
    });
    if (response.stop_reason === "refusal") throw new Error("הבקשה נדחתה על ידי המודל");
    response.content.forEach(collect);

    const call = response.content.find((b) => b.type === "tool_use" && b.name === "submit_products");
    if (call) {
      const input = typeof call.input === "string" ? JSON.parse(call.input) : call.input;
      const seenHosts = new Set([...seen].map(host));
      const results = (input.results ?? []).filter((r) => /^https?:\/\//.test(r.url) && (seen.has(r.url) || seenHosts.has(host(r.url))));
      return { name: input.name, identified: input.identified, query: input.query, results, searched_with_photo: Boolean(item.image) };
    }
    if (response.stop_reason === "pause_turn") {
      messages.splice(1, messages.length - 1, { role: "assistant", content: response.content });
      continue;
    }
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: "קרא עכשיו ל-submit_products עם מה שמצאת." });
  }
  throw new Error("לא התקבלה תשובה מהחיפוש");
}
