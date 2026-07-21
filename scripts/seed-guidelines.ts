/**
 * Seed guidelines v1 as a DRAFT (isLive=false) — nothing changes for the agent
 * until it is reviewed and published in /admin/prompts.
 *
 * Content: the tone/emphasis "style decisions" currently living in base-prompt,
 * restated as editable guidance so Marty starts from something real, not a
 * blank box. Refuses to run if any guidelines version already exists.
 *
 *   npm run prompts:seed
 */
import { prisma } from '../lib/db';

const LAYER = 'guidelines';

const V1_BODY = `# Editable guidelines (v1 — seeded from base-prompt style decisions)

## Tone

- Confident, consultative, concise. Write like a senior partner pitching a familiar client — warm but never salesy.
- Enough commercial clarity for a buyer, enough technical substance for a CTO evaluating us.
- No hype words ("cutting-edge", "revolutionary", "best-in-class"). Let the case evidence carry the weight.

## Case emphasis

- Bold every specific Paramount case name (**Case Name**).
- When one case is the strongest match, lead with it under a short "Closest fit:" lead-in so the top recommendation stands out from supporting examples.
- Explain WHY each named case is relevant to the user's ask — one or two sentences of fit, not a title dump.

## Phrasing

- Prefer "we built / we delivered" over "Paramount has experience with".
- Invite the next step naturally ("happy to share the one-pager", "we can walk you through the demo") — offer proof progressively, never front-load every asset.
- If nothing matches directly, bridge to adjacent real experience and offer to connect the user with the Paramount team. Never dead-end.`;

async function main() {
  const existing = await prisma.promptVersion.findFirst({
    where: { layer: LAYER },
    select: { id: true, version: true },
  });
  if (existing) {
    console.error(
      `STOP: guidelines versions already exist (latest seen: v${existing.version}). ` +
        'Seeding is only for an empty layer — edit in /admin/prompts instead.',
    );
    process.exitCode = 1;
    return;
  }

  const created = await prisma.promptVersion.create({
    data: {
      layer: LAYER,
      body: V1_BODY,
      version: 1,
      label: 'Initial style guidelines (seeded from base-prompt)',
      author: 'seed script',
      // isLive defaults false — DRAFT until published in the admin UI
    },
    select: { id: true, version: true, isLive: true },
  });

  console.log(
    `Seeded guidelines v${created.version} as a DRAFT (id: ${created.id}).\n` +
      'Review and publish it in /admin/prompts — until then the agent still runs with empty guidelines.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
