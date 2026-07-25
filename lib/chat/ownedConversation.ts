/**
 * Shared ownership helpers for session-gated conversation APIs.
 * Soft-deleted conversations are 404 for the owning user (admin still sees them).
 */
import { prisma } from '@/lib/db';

export async function findOwnedActiveConversation(
  conversationId: string,
  agentUserId: string,
) {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId: agentUserId,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
    },
  });
}
