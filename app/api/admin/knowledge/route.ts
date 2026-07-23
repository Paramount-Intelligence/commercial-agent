/**
 * Admin knowledge list + create.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { uploadKnowledgeFile, deleteAsset } from '@/lib/storage/blob';
import {
  detectKnowledgeFileFormat,
  readExtractedTextField,
  resolveKnowledgeAttachmentText,
} from '@/lib/knowledge/resolveAttachmentText';
import { replaceAdminKnowledgeChunks } from '@/lib/knowledge/ingestAdminKnowledge';

export const runtime = 'nodejs';

const MAX_BYTES = 40 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // browsers sometimes send this for docx
]);

function serializeEntry(entry: {
  id: string;
  title: string;
  body: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileMime: string | null;
  shareable: boolean;
  shareLabel: string | null;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { name: string; email: string };
}) {
  return {
    id: entry.id,
    title: entry.title,
    body: entry.body,
    fileUrl: entry.fileUrl,
    fileName: entry.fileName,
    fileMime: entry.fileMime,
    shareable: entry.shareable,
    shareLabel: entry.shareLabel,
    chunkCount: entry.chunkCount,
    sourceType: 'admin-knowledge',
    sourceUrl: `admin-knowledge://${entry.id}`,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    createdByName: entry.createdBy.name,
    createdByEmail: entry.createdBy.email,
  };
}

/** List all admin knowledge entries. */
export async function GET() {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const entries = await prisma.knowledgeEntry.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        createdBy: { select: { name: true, email: true } },
      },
    });

    return NextResponse.json({
      entries: entries.map(serializeEntry),
    });
  } catch (err) {
    console.error('[api/admin/knowledge GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Create a knowledge entry (title + optional body + optional PDF/DOCX).
 * Multipart: title, body?, file?, extractedText? (required for PDF — browser-extracted).
 */
export async function POST(req: Request) {
  let uploadedUrl: string | null = null;
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const form = await req.formData();
    const title = String(form.get('title') ?? '').trim();
    const body = String(form.get('body') ?? '').trim() || null;
    const shareable = String(form.get('shareable') ?? '') === 'true';
    const shareLabel = String(form.get('shareLabel') ?? '').trim() || null;
    const extractedTextRaw = readExtractedTextField(form);
    const file = form.get('file');

    if (!title) {
      return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
    }

    if (shareable && !shareLabel) {
      return NextResponse.json(
        {
          error:
            'Share label is required when “Shareable with users” is enabled (what Jackie calls the file).',
        },
        { status: 400 },
      );
    }

    let fileUrl: string | null = null;
    let fileName: string | null = null;
    let fileMime: string | null = null;
    let fileText: string | null = null;

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: 'File exceeds 40 MB limit.' },
          { status: 400 },
        );
      }
      const format = detectKnowledgeFileFormat(file.name, file.type);
      if (!format) {
        return NextResponse.json(
          { error: 'Only PDF or DOCX files are accepted.' },
          { status: 400 },
        );
      }
      if (file.type && !ALLOWED_MIME.has(file.type) && format === 'docx') {
        // allow odd mime for docx
      } else if (file.type && format === 'pdf' && file.type !== 'application/pdf') {
        return NextResponse.json(
          { error: `Unexpected MIME type for PDF: ${file.type}` },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const resolved = await resolveKnowledgeAttachmentText({
        format,
        buffer,
        filename: file.name,
        mime: file.type,
        extractedTextRaw,
      });
      if ('error' in resolved) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }

      const contentType =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const uploaded = await uploadKnowledgeFile(buffer, file.name, contentType);
      uploadedUrl = uploaded.url;
      fileUrl = uploaded.url;
      fileName = file.name;
      fileMime = contentType;
      fileText = resolved.text;
    }

    if (!body && !fileText) {
      return NextResponse.json(
        {
          error:
            'Provide body text and/or attach a PDF/DOCX with extractable text.',
        },
        { status: 400 },
      );
    }

    if (shareable && !fileUrl) {
      return NextResponse.json(
        {
          error:
            'Shareable entries must include a file attachment users can download.',
        },
        { status: 400 },
      );
    }

    const entry = await prisma.knowledgeEntry.create({
      data: {
        title,
        body,
        fileUrl,
        fileName,
        fileMime,
        shareable,
        shareLabel: shareable ? shareLabel : null,
        createdById: auth.admin.id,
      },
      include: { createdBy: { select: { name: true, email: true } } },
    });

    try {
      const { chunkCount } = await replaceAdminKnowledgeChunks({
        entryId: entry.id,
        title,
        body,
        fileText,
        fileLabel: fileName,
      });
      const refreshed = await prisma.knowledgeEntry.findUniqueOrThrow({
        where: { id: entry.id },
        include: { createdBy: { select: { name: true, email: true } } },
      });
      return NextResponse.json({
        entry: serializeEntry(refreshed),
        message: `Added, ${chunkCount} chunk${chunkCount === 1 ? '' : 's'} embedded — the agent can now use this via search_company_info.`,
      });
    } catch (embedErr) {
      await prisma.knowledgeEntry.delete({ where: { id: entry.id } }).catch(() => {});
      if (uploadedUrl) await deleteAsset(uploadedUrl).catch(() => {});
      throw embedErr;
    }
  } catch (err) {
    console.error('[api/admin/knowledge POST]', err);
    if (uploadedUrl) await deleteAsset(uploadedUrl).catch(() => {});
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to create knowledge entry',
      },
      { status: 500 },
    );
  }
}
