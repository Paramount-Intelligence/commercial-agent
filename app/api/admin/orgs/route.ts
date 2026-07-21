import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { encryptSecret } from '@/lib/crypto/orgSecret';
import { utcToday } from '@/lib/gating/orgLimit';
import { DEFAULT_DAILY_LLM_TOKEN_LIMIT } from '@/lib/gating/costRates';
import {
  DEFAULT_DAILY_STT_SECOND_LIMIT,
  DEFAULT_DAILY_TTS_CHAR_LIMIT,
} from '@/lib/gating/voiceLimit';
import {
  deriveAvailableOrgEmail,
  generateOrgPassword,
  sealOrgPassword,
} from '@/lib/orgs/credentials';

export const runtime = 'nodejs';

/** List orgs — never includes password fields. */
export async function GET() {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const today = new Date(`${utcToday()}T00:00:00.000Z`);

    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        dailyMsgLimit: true,
        dailyLlmTokenLimit: true,
        dailyTtsCharLimit: true,
        dailySttSecondLimit: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
    });

    const usageToday = await prisma.orgUsageDay.findMany({
      where: {
        day: today,
        organizationId: { in: orgs.map((o) => o.id) },
      },
      select: {
        organizationId: true,
        messageCount: true,
        llmTokens: true,
        ttsChars: true,
        sttSeconds: true,
      },
    });
    const usedByOrg = new Map(
      usageToday.map((u) => [u.organizationId, u.messageCount]),
    );

    return NextResponse.json({
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        email: o.email,
        active: o.active,
        dailyMsgLimit: o.dailyMsgLimit,
        dailyLlmTokenLimit: o.dailyLlmTokenLimit,
        dailyTtsCharLimit: o.dailyTtsCharLimit,
        dailySttSecondLimit: o.dailySttSecondLimit,
        createdAt: o.createdAt.toISOString(),
        userCount: o._count.users,
        messagesUsedToday: usedByOrg.get(o.id) ?? 0,
        llmTokensUsedToday:
          usageToday.find((usage) => usage.organizationId === o.id)?.llmTokens ??
          0,
        ttsCharsUsedToday:
          usageToday.find((usage) => usage.organizationId === o.id)?.ttsChars ??
          0,
        sttSecondsUsedToday:
          usageToday.find((usage) => usage.organizationId === o.id)
            ?.sttSeconds ?? 0,
      })),
    });
  } catch (err) {
    console.error('[api/admin/orgs GET] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Create org — same logic as scripts/create-org.ts.
 * Returns plaintext password ONCE in this response.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    let body: {
      name?: string;
      dailyMsgLimit?: number;
      dailyLlmTokenLimit?: number;
      dailyTtsCharLimit?: number;
      dailySttSecondLimit?: number;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    let dailyMsgLimit = 1000;
    if (body.dailyMsgLimit !== undefined) {
      const n = Number(body.dailyMsgLimit);
      if (!Number.isInteger(n) || n < 1) {
        return NextResponse.json(
          { error: 'dailyMsgLimit must be a positive integer' },
          { status: 400 },
        );
      }
      dailyMsgLimit = n;
    }
    let dailyTtsCharLimit = DEFAULT_DAILY_TTS_CHAR_LIMIT;
    let dailyLlmTokenLimit = DEFAULT_DAILY_LLM_TOKEN_LIMIT;
    if (body.dailyLlmTokenLimit !== undefined) {
      const n = Number(body.dailyLlmTokenLimit);
      if (!Number.isInteger(n) || n < 1) {
        return NextResponse.json(
          { error: 'dailyLlmTokenLimit must be a positive integer' },
          { status: 400 },
        );
      }
      dailyLlmTokenLimit = n;
    }
    if (body.dailyTtsCharLimit !== undefined) {
      const n = Number(body.dailyTtsCharLimit);
      if (!Number.isInteger(n) || n < 1) {
        return NextResponse.json(
          { error: 'dailyTtsCharLimit must be a positive integer' },
          { status: 400 },
        );
      }
      dailyTtsCharLimit = n;
    }
    let dailySttSecondLimit = DEFAULT_DAILY_STT_SECOND_LIMIT;
    if (body.dailySttSecondLimit !== undefined) {
      const n = Number(body.dailySttSecondLimit);
      if (!Number.isInteger(n) || n < 1) {
        return NextResponse.json(
          { error: 'dailySttSecondLimit must be a positive integer' },
          { status: 400 },
        );
      }
      dailySttSecondLimit = n;
    }

    // Fail fast if ORG_SECRET_KEY is missing
    try {
      encryptSecret('key-check');
    } catch (e) {
      console.error('[api/admin/orgs POST] ORG_SECRET_KEY', e);
      return NextResponse.json(
        { error: 'Server cannot encrypt org credentials (ORG_SECRET_KEY).' },
        { status: 500 },
      );
    }

    const sameName = await prisma.organization.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    if (sameName) {
      return NextResponse.json(
        {
          error: `An organization named "${name}" already exists (${sameName.email}).`,
        },
        { status: 409 },
      );
    }

    const email = await deriveAvailableOrgEmail(name);
    const password = generateOrgPassword();
    const sealed = await sealOrgPassword(password);

    const org = await prisma.organization.create({
      data: {
        name,
        email,
        passwordHash: sealed.passwordHash,
        passwordEnc: sealed.passwordEnc,
        dailyMsgLimit,
        dailyLlmTokenLimit,
        dailyTtsCharLimit,
        dailySttSecondLimit,
      },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        dailyMsgLimit: true,
        dailyLlmTokenLimit: true,
        dailyTtsCharLimit: true,
        dailySttSecondLimit: true,
        createdAt: true,
      },
    });

    console.log(
      `[admin/orgs] CREATE org=${org.id} email=${org.email} by admin=${auth.admin.id} (${auth.admin.email}) at ${new Date().toISOString()}`,
    );

    return NextResponse.json({
      organization: {
        ...org,
        createdAt: org.createdAt.toISOString(),
        userCount: 0,
        messagesUsedToday: 0,
        llmTokensUsedToday: 0,
        ttsCharsUsedToday: 0,
        sttSecondsUsedToday: 0,
      },
      password, // plaintext ONCE
    });
  } catch (err) {
    console.error('[api/admin/orgs POST] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
