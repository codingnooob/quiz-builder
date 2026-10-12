import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
// The project's Drizzle schema — the source of truth for `npm run db:generate` (A3.5). Add the app's tables
// below. Event logs, telemetry and analytics streams do not belong in this database (A3.18).
export * from './schema.auth';

// Quiz Builder. A quiz is reached by its unguessable id (no accounts): the link is the access.
const now = () => new Date().toISOString();

export const quizzes = sqliteTable('quizzes', {
  id: text().primaryKey(),
  title: text().notNull(),
  fileName: text('file_name').notNull(),
  fileKey: text('file_key'),
  /** draft (chapters detected) → ready (questions generated) */
  status: text().notNull().default('draft'),
  /** 'total' (count spread over the chapters) or 'per_section' */
  countMode: text('count_mode').notNull().default('per_section'),
  questionCount: integer('question_count').notNull().default(5),
  /** easy | medium | hard | mixed */
  difficulty: text().notNull().default('mixed'),
  /** JSON array of language names, e.g. ["English","Spanish"] */
  languages: text().notNull().default('["English"]'),
  truncated: integer({ mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(now),
});

export const quizSections = sqliteTable(
  'quiz_sections',
  {
    id: text().primaryKey(),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    included: integer({ mode: 'boolean' }).notNull().default(true),
    targetQuestions: integer('target_questions').notNull().default(0),
  },
  (t) => [index('quiz_sections_quiz_id').on(t.quizId)],
);

export const quizQuestions = sqliteTable(
  'quiz_questions',
  {
    id: text().primaryKey(),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    sectionId: text('section_id')
      .notNull()
      .references(() => quizSections.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    difficulty: text().notNull(),
    correctIndex: integer('correct_index').notNull(),
    /** JSON: { [language]: { question, options: string[], explanation } } — same option order in every language */
    content: text().notNull(),
  },
  (t) => [index('quiz_questions_quiz_id').on(t.quizId), index('quiz_questions_section_id').on(t.sectionId)],
);

export const quizPdfs = sqliteTable(
  'quiz_pdfs',
  {
    id: text().primaryKey(),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    language: text().notNull(),
    /** questions | answers */
    kind: text().notNull(),
    url: text().notNull(),
    fileKey: text('file_key'),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('quiz_pdfs_unique').on(t.quizId, t.language, t.kind)],
);
