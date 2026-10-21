/**
 * Repair Lead PDF rows that still point at dead legacy local paths.
 *
 * The maintenance route calls this only behind FILE_MIGRATION_ENABLED and an
 * admin session. Dry run is the default. Applied work either regenerates the
 * PDF from the Lead + Conversation data already in the database, or clears
 * pdfUrl when the Lead does not have enough saved data to regenerate safely.
 * Responses and logs contain counts only.
 */
import { prisma } from '../db';
import { generateConversationPdf } from '../leads/generateConversationPdf';
import { storageMode } from './blob';
import { DEFAULT_BATCH, MAX_BATCH } from './migrateFiles';

export type LeadPdfRepairCandidate = {
  id: string;
  conversationId: string;
  name: string;
  email: string;
  company: string | null;
  topic: string | null;
  context: string | null;
  pdfUrl: string;
};

export type LeadPdfRepairStore = {
  candidates(): Promise<LeadPdfRepairCandidate[]>;
  generate(input: {
    conversationId: string;
    leadName: string;
    leadEmail: string;
    leadCompany: string | null;
    topic: string;
  }): Promise<{ url: string; bytes: number }>;
  commitRegenerated(row: LeadPdfRepairCandidate, newUrl: string): Promise<void>;
  commitCleared(row: LeadPdfRepairCandidate): Promise<void>;
  access(): { access: 'private' | 'public'; kind: string };
};

export type LeadPdfRepairCounts = {
  plannedRegenerate: number;
  plannedClear: number;
  regenerated: number;
  cleared: number;
  failed: number;
};

export type LeadPdfRepairResult = {
  apply: boolean;
  access: 'private' | 'public';
  mode: string;
  counts: LeadPdfRepairCounts;
  remaining: number;
};

const DEAD_LOCAL_PREFIX = '/uploads/';

export const prismaLeadPdfRepairStore: LeadPdfRepairStore = {
  candidates: async () =>
    (
      await prisma.lead.findMany({
        where: { pdfUrl: { startsWith: DEAD_LOCAL_PREFIX } },
        select: {
          id: true,
          conversationId: true,
          name: true,
          email: true,
          company: true,
          topic: true,
          context: true,
          pdfUrl: true,
        },
        orderBy: { id: 'asc' },
      })
    ).map((lead) => ({ ...lead, pdfUrl: lead.pdfUrl! })),
  generate: async (input) => {
    const pdf = await generateConversationPdf(input);
    return { url: pdf.url, bytes: pdf.buffer.byteLength };
  },
  commitRegenerated: async (row, newUrl) => {
    await prisma.$transaction([
      prisma.lead.update({ where: { id: row.id }, data: { pdfUrl: newUrl } }),
      prisma.fileMigrationLog.create({
        data: {
          tableName: 'Lead',
          recordId: row.id,
          action: 'regenerate-lead-pdf',
          oldUrl: row.pdfUrl,
          newUrl,
        },
      }),
    ]);
  },
  commitCleared: async (row) => {
    await prisma.$transaction([
      prisma.lead.update({ where: { id: row.id }, data: { pdfUrl: null } }),
      prisma.fileMigrationLog.create({
        data: {
          tableName: 'Lead',
          recordId: row.id,
          action: 'clear-lead-pdf',
          oldUrl: row.pdfUrl,
          newUrl: null,
        },
      }),
    ]);
  },
  access: () => {
    const mode = storageMode();
    return { access: mode.access, kind: mode.kind };
  },
};

/** Use the saved topic; older rows may only have the longer context field. */
export function savedLeadTopic(row: Pick<LeadPdfRepairCandidate, 'topic' | 'context'>): string | null {
  return row.topic?.trim() || row.context?.trim() || null;
}

export function canRegenerateLeadPdf(row: LeadPdfRepairCandidate): boolean {
  return Boolean(row.name.trim() && row.email.trim() && savedLeadTopic(row));
}

export async function repairLeadPdfs(
  opts: { apply?: boolean; limit?: number } = {},
  store: LeadPdfRepairStore = prismaLeadPdfRepairStore,
): Promise<LeadPdfRepairResult> {
  const apply = opts.apply === true;
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? DEFAULT_BATCH), MAX_BATCH));
  const mode = store.access();
  const candidates = await store.candidates();
  const counts: LeadPdfRepairCounts = {
    plannedRegenerate: candidates.filter(canRegenerateLeadPdf).length,
    plannedClear: candidates.filter((row) => !canRegenerateLeadPdf(row)).length,
    regenerated: 0,
    cleared: 0,
    failed: 0,
  };

  if (!apply) return { apply, access: mode.access, mode: mode.kind, counts, remaining: candidates.length };
  if (mode.access !== 'private') {
    throw new Error(
      `Storage mode is ${mode.kind} (not a private store): refusing to repair Lead PDFs. ` +
        'Run the repair on the deployment, where the private store is reached with OIDC.',
    );
  }

  for (const row of candidates.slice(0, limit)) {
    const topic = savedLeadTopic(row);
    if (!canRegenerateLeadPdf(row) || !topic) {
      await store.commitCleared(row);
      counts.cleared++;
      continue;
    }
    try {
      const generated = await store.generate({
        conversationId: row.conversationId,
        leadName: row.name,
        leadEmail: row.email,
        leadCompany: row.company,
        topic,
      });
      await store.commitRegenerated(row, generated.url);
      counts.regenerated++;
    } catch {
      // A transient render/upload/database failure must not erase the old row.
      counts.failed++;
    }
  }

  return {
    apply,
    access: mode.access,
    mode: mode.kind,
    counts,
    remaining: (await store.candidates()).length,
  };
}
