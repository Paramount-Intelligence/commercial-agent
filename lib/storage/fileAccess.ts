/**
 * Who may download what. Buyers get a case one-pager only if it was given to
 * them in one of their own conversations; shareable company documents to any
 * signed-in buyer; transcripts only their own (checked in the transcript
 * route). Admin-only files need an adviser admin session (route level).
 */
import { prisma } from '../db';
import { isRetiredKnowledgeEntry } from '../knowledge/companyInfoExclusions';

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export function isSafeId(id: string | null | undefined): id is string {
  return Boolean(id && ID_RE.test(id));
}

/** True when an attachment for this case appears in one of the user's non-deleted conversations. */
export async function userWasGivenCaseFile(userId: string, caseId: string): Promise<boolean> {
  if (!isSafeId(caseId)) return false;
  const hit = await prisma.message.findFirst({
    where: {
      role: 'assistant',
      content: { contains: `"caseId":"${caseId}"` },
      conversation: { userId, deletedAt: null },
    },
    select: { id: true },
  });
  return Boolean(hit);
}

/** The shareable document a buyer may download, or null. */
export async function shareableKnowledgeFile(entryId: string) {
  if (!isSafeId(entryId)) return null;
  const entry = await prisma.knowledgeEntry.findFirst({
    where: { id: entryId, shareable: true, fileUrl: { not: null } },
    select: { id: true, title: true, shareLabel: true, fileUrl: true, fileName: true, fileMime: true },
  });
  if (!entry || isRetiredKnowledgeEntry(entry)) return null;
  return entry;
}
