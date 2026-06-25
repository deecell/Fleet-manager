---
name: Drizzle raw-sql array binding (ANY vs IN)
description: Interpolating a JS array into a raw drizzle sql`` template — why ANY() breaks and the IN-list fix.
---

In a raw drizzle `sql\`\`` template, interpolating a JS array like `${truckIds}` does **not** bind a single Postgres array parameter. Drizzle expands it into a comma-separated list of bound params (`$1, $2, $3, ...`).

- `col = ANY(${jsArray})` → `ANY($1, $2, ...)` → Postgres sees a scalar on the right and throws **`op ANY/ALL (array) requires array on right side`**. Fails for every non-empty array.
- Correct pattern: build an explicit list and use `IN`:
  ```ts
  const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  // ... WHERE col IN (${list})
  ```
  Guard `ids.length === 0` before, since `IN ()` is invalid SQL.

**Why this bit hard to catch:** the bug only surfaces with a **non-empty, real** array against actual rows. A dev DB with an empty table, or a hand-written diagnostic that hardcodes `ANY(ARRAY[...])` (a literal array, not the bound param), both pass while the real bound-parameter path throws. To reproduce a raw-sql binding bug, run the **exact** `sql\`\`` template with the **same JS values** through `db.execute` (e.g. via tsx), not a hand-edited SQL string.

**How to apply:** when writing `ANY`/`IN` over a JS array inside a raw drizzle `sql` template, prefer `IN (${sql.join(...)})`, or use the `inArray()` helper when not in raw SQL. Same node-postgres driver is used in dev and prod (`drizzle-orm/node-postgres` in `server/db.ts`), so this reproduces identically in both.
