import { generateObject } from 'ai';
import { z } from 'zod';

import { model } from '@/agents/model';
import { AI_MODELS } from '@/lib/ai-models';

import { MAX_SECTIONS } from './types';

export type RawSection = { title: string; content: string };

const BLOCK_CHARS = 700;
const PREVIEW_CHARS = 150;

/** Consecutive lines grouped into blocks of ~700 characters; a heading line always starts a new block. */
function toBlocks(text: string): string[] {
  const blocks: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const isHeading = /^#{1,6}\s/.test(line);
    if (cur && (isHeading || cur.length >= BLOCK_CHARS)) {
      blocks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function evenSplit(blocks: string[], parts: number): RawSection[] {
  const per = Math.ceil(blocks.length / parts);
  const out: RawSection[] = [];
  for (let i = 0; i < blocks.length; i += per)
    out.push({ title: `Part ${out.length + 1}`, content: blocks.slice(i, i + per).join('\n') });
  return out;
}

/**
 * Splits a document into chapters. The model only sees a numbered preview of each block and answers where chapters
 * start, so the chapter texts are cut from the original and nothing is rewritten. `wanted` = exact count, or null (auto).
 */
export async function splitIntoSections(text: string, fileTitle: string, wanted: number | null): Promise<RawSection[]> {
  const blocks = toBlocks(text);
  if (blocks.length < 2 || text.length < 1200 || wanted === 1) return [{ title: fileTitle, content: text }];

  const target = wanted ? Math.min(wanted, blocks.length, MAX_SECTIONS) : null;
  const preview = blocks.map((b, i) => `[${i}] ${b.slice(0, PREVIEW_CHARS).replace(/\s+/g, ' ')}`).join('\n');
  try {
    const { object } = await generateObject({
      model: model(AI_MODELS.split),
      maxRetries: 1,
      schema: z.object({
        chapters: z.array(z.object({ title: z.string(), startBlock: z.number().int() })),
      }),
      prompt: `Below is a document cut into numbered blocks (each line shows the start of one block).
Divide it into coherent chapters or modules for a study quiz: follow the document's own headings and structure when it has them, otherwise group by topic.
${target ? `Return exactly ${target} chapters.` : `Return between 2 and ${Math.min(MAX_SECTIONS, 20)} chapters; each should cover a meaningful amount of text.`}
For each chapter give a short, clear title (in the document's language, max 80 characters) and "startBlock", the number of the block where it begins. startBlock values must be increasing and the first must be 0.

Document "${fileTitle}":
${preview}`,
    });
    const starts = new Map<number, string>();
    for (const c of object.chapters) {
      if (c.startBlock >= 0 && c.startBlock < blocks.length && !starts.has(c.startBlock) && c.title.trim())
        starts.set(c.startBlock, c.title.trim().slice(0, 120));
    }
    const ordered = [...starts.entries()].sort((a, b) => a[0] - b[0]);
    if (ordered.length === 0) throw new Error('no chapters');
    if (ordered[0]![0] !== 0) ordered.unshift([0, ordered[0]![1]]);
    if (ordered[0]![0] === 0 && ordered.length === 1 && blocks.length > 6 && target !== 1) throw new Error('one chapter only');
    const sections = ordered.slice(0, MAX_SECTIONS).map(([start, title], i, arr) => ({
      title,
      content: blocks.slice(start, i + 1 < arr.length ? arr[i + 1]![0] : blocks.length).join('\n'),
    }));
    return sections;
  } catch (err) {
    console.error('chapter detection failed, splitting evenly', err);
    return evenSplit(blocks, target ?? Math.min(8, Math.max(2, Math.round(text.length / 8000))));
  }
}
