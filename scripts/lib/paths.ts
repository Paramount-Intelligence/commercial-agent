/**
 * Locations of private inputs and outputs for seed and eval scripts.
 * Knowledge drafts, golden questions and reports live OUTSIDE the repo;
 * these paths refuse to resolve inside it (except the gitignored .seed/).
 *
 *   KNOWLEDGE_DIR  drafts + manifest   (default D:\Paramount Intelligence\Knowledge)
 *   EVAL_DIR       golden-questions.yaml and label maps (default KNOWLEDGE_DIR\reports)
 *   EVAL_OUT       dated eval reports, caches, API ledger (default D:\Paramount Intelligence\Jackie Notes\evals)
 */
import { mkdirSync } from 'fs';
import { join, relative, resolve, isAbsolute } from 'path';

export const REPO_ROOT = resolve(__dirname, '..', '..');

function outsideRepo(name: string, value: string): string {
  const abs = resolve(value);
  const rel = relative(REPO_ROOT, abs);
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    throw new Error(`${name} must point outside the repo (got a path inside it).`);
  }
  return abs;
}

export function knowledgeDir(): string {
  return outsideRepo(
    'KNOWLEDGE_DIR',
    process.env.KNOWLEDGE_DIR?.trim() || 'D:/Paramount Intelligence/Knowledge',
  );
}

export function evalDir(): string {
  return outsideRepo('EVAL_DIR', process.env.EVAL_DIR?.trim() || join(knowledgeDir(), 'reports'));
}

export function evalOut(...sub: string[]): string {
  const base = outsideRepo(
    'EVAL_OUT',
    process.env.EVAL_OUT?.trim() || 'D:/Paramount Intelligence/Jackie Notes/evals',
  );
  const dir = join(base, ...sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Gitignored folder inside the repo for seed credentials (see .gitignore). */
export function seedDir(): string {
  const dir = join(REPO_ROOT, '.seed');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 2026-10-20T14-03-11 — safe in file names. */
export function stamp(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace(/:/g, '-');
}
