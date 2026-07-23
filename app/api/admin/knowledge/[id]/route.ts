/**
 * Admin knowledge update + delete.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { uploadKnowledgeFile, deleteAsset } from '@/lib/storage/blob';
import {
  detectKnowledgeFileFormat,
  extractKnowledgeFileText,
} from '@/lib/knowledge/extractText';
import {
  deleteAdminKnowledgeChunks,
  replaceAdminKnowledgeChunks,
} from '@/lib/knowledge/ingestAdminKnowledge';

export const runtime = 'nodejs';

const MAX_BYTES = 40 * 1024 * 1024;

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

async function loadEntry(id: string) {
  return prisma.knowledgeEntry.findUnique({
    where: { id },
    include: { createdBy: { select: { name: true, email: true } } },
  });
}

/**
 * Update title/body and optionally replace the attached file.
 * Multipart: title, body?, file?, clearFile?=true
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let uploadedUrl: string | null = null;
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await params;
    const existing = await loadEntry(id);
    if (!existing) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    const form = await req.formData();
    const title = String(form.get('title') ?? existing.title).trim();
    const bodyRaw = form.get('body');
    const body =
      bodyRaw === null
        ? existing.body
        : String(bodyRaw).trim() || null;
    const clearFile = String(form.get('clearFile') ?? '') === 'true';
    const file = form.get('file');
    const shareableRaw = form.get('shareable');
    const shareable =
      shareableRaw === null
        ? existing.shareable
        : String(shareableRaw) === 'true';
    const shareLabelRaw = form.get('shareLabel');
    const shareLabel =
      shareLabelRaw === null
        ? existing.shareLabel
        : String(shareLabelRaw).trim() || null;

    if (!title) {
      return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
    }

    if (shareable && !(shareLabel ?? '').trim()) {
      return NextResponse.json(
        {
          error:
            'Share label is required when “Shareable with users” is enabled (what Jackie calls the file).',
        },
        { status: 400 },
      );
    }

    let fileUrl = existing.fileUrl;
    let fileName = existing.fileName;
    let fileMime = existing.fileMime;
    let fileText: string | null = null;
    let previousFileUrl: string | null = null;

    if (clearFile) {
      previousFileUrl = existing.fileUrl;
      fileUrl = null;
      fileName = null;
      fileMime = null;
    }

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
      const buffer = Buffer.from(await file.arrayBuffer());
      const extracted = await extractKnowledgeFileText({
        buffer,
        filename: file.name,
        mime: file.type,
      });
      if (extracted.empty) {
        return NextResponse.json(
          {
            error:
              format === 'pdf'
                ? 'This PDF has no extractable text (it may be a scanned image). OCR is not supported — paste the text into the body field, or upload a text-based PDF/DOCX.'
                : 'This DOCX has no extractable text. Paste content into the body field instead.',
          },
          { status: 400 },
        );
      }
      const contentType =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const uploaded = await uploadKnowledgeFile(buffer, file.name, contentType);
      uploadedUrl = uploaded.url;
      previousFileUrl = existing.fileUrl;
      fileUrl = uploaded.url;
      fileName = file.name;
      fileMime = contentType;
      fileText = extracted.text;
    } else if (fileUrl && !clearFile) {
      // Keep existing file — re-extract text for re-embed.
      try {
        let buffer: Buffer | null = null;
        if (fileUrl.startsWith('/uploads/')) {
          const { readFile } = await import('fs/promises');
          const path = await import('path');
          const filePath = path.join(
            process.cwd(),
            'public',
            fileUrl.replace(/^\//, ''),
          );
          buffer = await readFile(filePath);
        } else {
          const res = await fetch(fileUrl);
          if (res.ok) buffer = Buffer.from(await res.arrayBuffer());
        }
        if (buffer) {
          const extracted = await extractKnowledgeFileText({
            buffer,
            filename: fileName || 'attachment.pdf',
            mime: fileMime,
          });
          if (!extracted.empty) fileText = extracted.text;
        }
      } catch (err) {
        console.warn(
          '[api/admin/knowledge PATCH] re-extract existing file failed',
          err,
        );
      }
    }

    if (!body && !fileText) {
      return NextResponse.json(
        {
          error:
            'Provide body text and/or a file with extractable text before saving.',
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

    await prisma.knowledgeEntry.update({
      where: { id },
      data: {
        title,
        body,
        fileUrl,
        fileName,
        fileMime,
        shareable,
        shareLabel: shareable ? shareLabel : null,
      },
    });

    const { chunkCount } = await replaceAdminKnowledgeChunks({
      entryId: id,
      title,
      body,
      fileText,
      fileLabel: fileName,
    });

    if (previousFileUrl && previousFileUrl !== fileUrl) {
      await deleteAsset(previousFileUrl).catch(() => {});
    }

    const refreshed = await loadEntry(id);
    return NextResponse.json({
      entry: refreshed ? serializeEntry(refreshed) : null,
      message: `Updated, ${chunkCount} chunk${chunkCount === 1 ? '' : 's'} re-embedded.`,
    });
  } catch (err) {
    console.error('[api/admin/knowledge PATCH]', err);
    if (uploadedUrl) await deleteAsset(uploadedUrl).catch(() => {});
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to update knowledge entry',
      },
      { status: 500 },
    );
  }
}

/** Delete entry + ContentChunks + blob file. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await params;
    const existing = await loadEntry(id);
    if (!existing) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    await deleteAdminKnowledgeChunks(id);
    await prisma.knowledgeEntry.delete({ where: { id } });
    if (existing.fileUrl) {
      await deleteAsset(existing.fileUrl).catch(() => {});
    }

    return NextResponse.json({ ok: true, deletedId: id });
  } catch (err) {
    console.error('[api/admin/knowledge DELETE]', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to delete knowledge entry',
      },
      { status: 500 },
    );
  }
}
