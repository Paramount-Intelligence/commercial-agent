/**
 * Read Knowledge/manifest.yaml, the drafts and confidential-names.yaml (all
 * outside the repo) into a load plan. Shared by knowledge:ingest and
 * knowledge:bundle.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseConfidentialNames, parseManifest, planKnowledge, type KnowledgePlan } from '../../lib/knowledge/approved/manifest';
import { knowledgeDir } from './paths';

export function readKnowledgePlan(): KnowledgePlan {
  const dir = knowledgeDir();
  const manifest = parseManifest(readFileSync(join(dir, 'manifest.yaml'), 'utf8'));
  const confPath = [join(dir, 'confidential-names.yaml'), join(dir, 'reports', 'confidential-names.yaml')].find(existsSync);
  if (!confPath) throw new Error('confidential-names.yaml not found in KNOWLEDGE_DIR or KNOWLEDGE_DIR/reports');
  return planKnowledge(manifest, (p) => readFileSync(join(dir, p), 'utf8'), parseConfidentialNames(readFileSync(confPath, 'utf8')));
}

/** Counts only: never print names or text. */
export function describePlan(plan: KnowledgePlan): string {
  const byType = new Map<string, number>();
  for (const d of plan.docs) byType.set(d.type, (byType.get(d.type) ?? 0) + 1);
  return [
    `docs to load: ${plan.docs.length} (${[...byType].map(([t, n]) => `${t} ${n}`).join(', ')})`,
    `held (skipped): ${plan.held.length}`,
    `refused: ${plan.refused.length}${plan.refused.length ? ` → ${plan.refused.map((r) => `${r.id} [${typeof r.problems === 'string' ? r.problems : [...new Set(r.problems.map((p) => p.kind))].join(',')}]`).join('; ')}` : ''}`,
    `former employers: ${plan.formerEmployers.length}, confidential names: ${plan.confidentialNames.length}`,
  ].join('\n');
}
