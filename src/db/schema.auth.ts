import { sql } from 'drizzle-orm';
import { customType, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// The better-auth tables (plan 06 §7.3, A3.7) and the source of drizzle/0000_base.sql. Frozen: the base
// migration is never regenerated; a later change is a new migration. Timestamps are ISO-8601 TEXT.
const timestamp = customType<{ data: Date; driverData: string }>({
  dataType: () => 'text',
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => new Date(value),
});

export const users = sqliteTable(
  'users',
  {
    id: text().primaryKey(),
    email: text().notNull(),
    name: text(),
    emailVerified: integer({ mode: 'boolean' }).default(false).notNull(),
    image: text(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  // Case-insensitive uniqueness without COLLATE NOCASE, which a Drizzle schema cannot express. `users_email_key`: the
  // address without the dots of its local part (`jo.hn@x.com` → `john@x.com`), which the live sign-up refuses a second
  // account for in one indexed read (src/lib/login-guard.ts, EMAIL_KEY). Not unique: the preview skips that rule.
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    index('users_email_key').on(
      sql`lower(replace(substr(${t.email}, 1, instr(${t.email}, '@') - 1), '.', '') || substr(${t.email}, instr(${t.email}, '@')))`,
    ),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull(),
    expiresAt: timestamp().notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => [uniqueIndex('sessions_token_unique').on(t.token), index('sessions_user_id').on(t.userId)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    password: text(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp(),
    refreshTokenExpiresAt: timestamp(),
    scope: text(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => [index('accounts_user_id').on(t.userId)],
);

export const verifications = sqliteTable(
  'verifications',
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp().notNull(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => [index('verifications_identifier').on(t.identifier)],
);

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    id: text().primaryKey(),
    key: text().notNull(),
    count: integer().notNull(),
    lastRequest: integer().notNull(),
  },
  (t) => [uniqueIndex('rate_limits_key_unique').on(t.key)],
);
