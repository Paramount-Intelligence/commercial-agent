import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { serveStoredFile } from '@/lib/storage/serveFile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admin-only download of a lead's conversation PDF (personal data). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return adminUnauthorized();
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { pdfUrl: true } });
  if (!lead?.pdfUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return serveStoredFile(lead.pdfUrl, { filename: `lead-${id}.pdf`, contentType: 'application/pdf' });
}
