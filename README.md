# הוצאות הבית

A private household-expenses app: import credit card exports, auto-categorize, review, and see insights.

## Run

```bash
cd server && npm install && npm run dev   # API on http://127.0.0.1:3001
cd web && npm install && npm run dev      # UI on http://localhost:5180
```

Data lives in `server/data/expenses.db` (SQLite, gitignored). The API only listens on 127.0.0.1.

Optional AI suggestions for merchants the app has never seen: copy `server/.env.example` to `server/.env` and set `ANTHROPIC_API_KEY`.

## Categories, trips, views

- **Categories** have an optional sub-category level and a color. The colors were taken from the Google Sheet's conditional formatting, and you can edit everything under הגדרות (settings).
- **Trips are a tag, not a category.** A dinner in Rome is "אוכל בחוץ › מסעדות", tagged with the trip. Every non-fixed purchase inside a trip's date range is tagged; bookings paid in advance are attached by hand from the transactions screen.
- **Dashboards:** month (opens on the last full month, compared with the month before), year, with or without trips, and one dashboard per trip with a comparison between trips.

## How categorization works

For each imported transaction, in order:

1. **Fixed-expense rule:** merchant is marked as fixed (Netflix, ארנונה…), so it keeps its category and is never tagged to a trip.
2. **Cash withdrawal:** filed under משיכת מזומן.
3. **Payment apps (BIT etc.):** always sent to review.
4. **Merchant rule (category + sub-category):** learned from the Google Sheet and from every manual fix. Merchant names are matched regardless of word order, ids, suffixes like בע״מ and processor prefixes (BKG*, PAYPAL *…).
5. **AI suggestion / web search** (if `ANTHROPIC_API_KEY` is set) goes to review for approval.

## Imports

- **Cal (כאל) "פירוט עסקאות וזיכויים" .xlsx:** the card number is read from the title line. Pending rows ("בקליטה") are replaced on each import.
- **The Google Sheets workbook** (one tab per month): imported as history, and every row teaches a rule.

Re-importing is safe. Rows are matched on card + date + amount, so overlapping statements and history don't double count.

Adding another card company (Isracard, Max): add a parser in `server/src/importers/index.js`.

## Expenses outside the card

The "הוספה" tab also takes expenses that never show up in a card file:

- **Recurring** (rent, house committee, standing orders): set once with an amount, category, day of month and start month.
  A row is added for every month up to today, marked fixed, with card "ללא כרטיס". A new amount can apply from a chosen
  month so earlier months keep what was paid; stopping keeps the history, deleting removes the months too.
- **One-off** (bank transfer, cash): a single row. A date inside a trip tags it with that trip.
