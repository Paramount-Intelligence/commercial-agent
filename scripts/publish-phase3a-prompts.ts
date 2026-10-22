/** Publish the three reviewed Phase 3a layers to staging through admin APIs. */
import { readFileSync } from 'fs';
import { join } from 'path';
import { BASE_PROMPT } from '../lib/agent/base-prompt';
import { GUIDELINES_PROMPT } from '../lib/agent/guidelines';
import { HARD_GUARDRAILS } from '../lib/agent/guardrails';

const BASE_URL = 'https://commercial-agent-staging.vercel.app';
const promptDir = 'D:/Paramount Intelligence/Jackie Notes/phase3/prompts';
const credentials = JSON.parse(
  readFileSync(join(process.cwd(), '.seed', 'credentials.staging.json'), 'utf8'),
) as { admin: { email: string; password: string } };

const bodies = {
  base: readFileSync(join(promptDir, 'base.md'), 'utf8').trim(),
  guidelines: readFileSync(join(promptDir, 'guidelines.md'), 'utf8').trim(),
  guardrails: readFileSync(join(promptDir, 'guardrails.md'), 'utf8').trim(),
};
const defaults = { base: BASE_PROMPT.trim(), guidelines: GUIDELINES_PROMPT.trim(), guardrails: HARD_GUARDRAILS.trim() };
for (const layer of Object.keys(bodies) as Array<keyof typeof bodies>) {
  if (bodies[layer] !== defaults[layer]) throw new Error(`${layer}.md does not match its code default`);
}

const jar = new Map<string, string>();
function absorb(res: Response) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const at = pair.indexOf('=');
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
}
const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');

async function request(path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Cookie: cookie() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  absorb(res);
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  await request('/api/admin/auth/login', credentials.admin);
  const published = [];
  for (const layer of ['base', 'guardrails', 'guidelines'] as const) {
    const draft = await request('/api/admin/prompts', {
      layer,
      body: bodies[layer],
      label: 'Phase 3a approved prompt',
    });
    const id = String(draft.id ?? '');
    if (!id) throw new Error(`${layer}: draft id missing`);
    const live = await request(`/api/admin/prompts/${id}/publish`, {
      ...(layer === 'guardrails' ? { confirmSafetyChange: true } : {}),
    });
    published.push({ layer, id, version: live.version });
  }
  for (const item of published) {
    const listing = await request(`/api/admin/prompts?layer=${item.layer}`);
    const versions = listing.versions as Array<{ id: string; isLive: boolean }>;
    if (!versions.some((row) => row.id === item.id && row.isLive)) {
      throw new Error(`${item.layer}: published version not live`);
    }
  }
  console.log(JSON.stringify({ target: BASE_URL, published }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
