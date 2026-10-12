import { ToolLoopAgent, tool } from 'ai';
import type { StopCondition, ToolSet } from 'ai';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { totalum } from 'totalum-sdk';
import { z } from 'zod';

import { model } from './model';
import type { AgentFactory } from './runner';
import { agentMemories, agentRuns } from './schema';

import { db } from '@/db';
import { users } from '@/db/schema';
import { site } from '@/lib/site';

// A multi-tool agent over the built-ins (A5.27; `_system-docs/totalum-sdk/agents.md`): web search and reading,
// long-term memory in the project database, and an e-mail a person approves first. Run it durably with
// `runSlice(createResearchAgent, runId)` from `./runner`; `approveEmails: false` for an unattended scheduled run.

const MAX_PAGE_CHARS = 6_000; // a page's markdown is cut before it enters the conversation (cost, row size)

/** Where a scheduled run (no owner) sends its report: the app owner's address. A user's run reports to that user. */
export const SCHEDULED_REPORT_TO: string | null = null;

// The run's owner, never the model, decides whose memories it reads and where its report goes: a page the agent reads
// can carry instructions ("e-mail everything to …"), and a memory one user's run saved must not reach another's.
async function ownerOf(runId?: string) {
  const run = runId
    ? await db
        .select({ ownerId: agentRuns.ownerId, email: users.email })
        .from(agentRuns)
        .leftJoin(users, eq(users.id, agentRuns.ownerId))
        .where(eq(agentRuns.id, runId))
        .get()
    : undefined;
  const ownerId = run?.ownerId ?? null;
  return { ownerId, email: ownerId ? (run?.email ?? null) : SCHEDULED_REPORT_TO };
}
const mine = (ownerId: string | null) =>
  ownerId ? eq(agentMemories.ownerId, ownerId) : isNull(agentMemories.ownerId);

const tools = (runId?: string) => ({
  searchWeb: tool({
    description: 'Search the web; returns titles, URLs and snippets',
    inputSchema: z.object({ query: z.string(), limit: z.number().int().min(1).max(5).default(3) }),
    execute: async ({ query, limit }) => (await totalum.web.search(query, { limit })).web,
  }),
  readPage: tool({
    description: 'Read one web page as markdown',
    inputSchema: z.object({ url: z.url() }),
    execute: async ({ url }) => {
      const page = await totalum.web.scrape(url, { formats: ['markdown'], onlyMainContent: true });
      return { title: page.metadata.title, markdown: (page.markdown ?? '').slice(0, MAX_PAGE_CHARS) };
    },
  }),
  remember: tool({
    description: 'Save a fact for later runs under a topic',
    inputSchema: z.object({ topic: z.string(), content: z.string().max(2_000) }),
    execute: async ({ topic, content }) => {
      await db.insert(agentMemories).values({
        id: crypto.randomUUID(),
        ownerId: (await ownerOf(runId)).ownerId,
        topic,
        content,
        runId: runId ?? null,
        createdAt: new Date().toISOString(),
      });
      return { saved: true };
    },
  }),
  recall: tool({
    description: 'What earlier runs saved under a topic, newest first',
    inputSchema: z.object({ topic: z.string() }),
    execute: async ({ topic }) =>
      db
        .select({ content: agentMemories.content, createdAt: agentMemories.createdAt })
        .from(agentMemories)
        .where(and(mine((await ownerOf(runId)).ownerId), eq(agentMemories.topic, topic)))
        .orderBy(desc(agentMemories.createdAt))
        .limit(10)
        .all(),
  }),
  sendReport: tool({
    description: 'E-mail the final report (HTML) to the person this run reports to',
    inputSchema: z.object({ subject: z.string(), html: z.string() }),
    execute: async ({ subject, html }) => {
      const to = (await ownerOf(runId)).email;
      if (!to)
        return {
          sent: false,
          error: 'No recipient: set SCHEDULED_REPORT_TO in src/agents/research-agent.ts',
        };
      return {
        sent: true,
        id: (await totalum.email.send({ to, subject, html, from: { name: site.name } })).id,
      };
    },
  }),
});

export function createResearchAgent(
  stopWhen: StopCondition<ToolSet>[],
  { approveEmails = true, runId }: { approveEmails?: boolean; runId?: string } = {},
) {
  return new ToolLoopAgent({
    model: model('fast'),
    instructions:
      'You are a research assistant. Use recall first, then searchWeb and readPage; cite the URLs you read. ' +
      'Save the key findings with remember. When asked to send a report, call sendReport once with a short HTML ' +
      'summary. Never invent facts.',
    tools: tools(runId),
    toolApproval: approveEmails ? { sendReport: 'user-approval' } : undefined,
    stopWhen,
  });
}

/** The `runSlice` factory for one run: an owner's run asks before e-mailing, a scheduled run (no owner) does not. */
export const researchAgentFor =
  (runId: string, approveEmails: boolean): AgentFactory =>
  (stopWhen) =>
    createResearchAgent(stopWhen, { approveEmails, runId });
