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
