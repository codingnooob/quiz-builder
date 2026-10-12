import { is } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { SQLiteRaw } from 'drizzle-orm/sqlite-core/query-builders/raw';
import { totalumD1 } from 'totalum-sdk/d1';

import * as schema from './schema';

// The only Totalum mention in the data path (plan 05 §3.9): the TOTALUM_DB binding inside a Worker, HTTPS to
// SDK-API with the project key anywhere else. Platform-owned; never edit.
const client = totalumD1();
export const db = drizzle(client, { schema, casing: 'snake_case' });

// Drizzle 0.45.3's D1 `batch()` binds a query with parameters through `preparedQuery.stmt`, which a raw
// `db.run/all/get/values(sql…)` never gets: `TypeError: Cannot read properties of undefined (reading 'bind')` before
// anything runs (research 69: every generated booking failed). Give each raw item its statement, so a guarded
// `INSERT … SELECT … WHERE` works inside `db.batch` and `loadPage` like any builder.
const batch = db.batch.bind(db);
db.batch = (queries) => {
  for (const q of queries) {
    if (is(q, SQLiteRaw) && !('stmt' in q)) Object.assign(q, { stmt: client.prepare(q.getQuery().sql) });
  }
  return batch(queries);
};
