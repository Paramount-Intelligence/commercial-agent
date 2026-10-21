import { requireAdmin } from '@/lib/auth/requireAdmin';
import { prisma } from '@/lib/db';
import { knowledgeSource, toAttribution } from '@/lib/knowledge/approved/catalog';
import { attributionWording } from '@/lib/knowledge/approved/attribution';
import AdminShell from '../AdminShell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only list of the approved knowledge the assistant answers from
 * (KnowledgeDoc). Loaded by `npm run knowledge:ingest` or the import route;
 * no editing here.
 */
export default async function ApprovedKnowledgePage() {
  const { admin } = await requireAdmin();
  const docs = await prisma.knowledgeDoc.findMany({
    select: {
      id: true,
      type: true,
      title: true,
      attribution: true,
      status: true,
      clientNameApproved: true,
      updatedAt: true,
      _count: { select: { chunks: true } },
    },
    orderBy: [{ status: 'asc' }, { type: 'asc' }, { title: 'asc' }],
  });
  const source = knowledgeSource();
  const active = docs.filter((d) => d.status !== 'retired');

  return (
    <AdminShell title="Approved knowledge" adminName={admin.name} adminRole={admin.role}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm text-slate-500">
          {active.length} active documents, {active.reduce((n, d) => n + d._count.chunks, 0)} chunks. The assistant
          reads this store when <code>KNOWLEDGE_SOURCE=approved</code>; this deployment uses{' '}
          <span className="font-semibold text-slate-700">{source}</span>.
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Attribution</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Chunks</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className={`border-t border-slate-100 ${d.status === 'retired' ? 'text-slate-400' : 'text-slate-700'}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{d.title}</div>
                    <div className="text-[11px] text-slate-400">{d.id}</div>
                  </td>
                  <td className="px-3 py-2">{d.type}</td>
                  <td className="px-3 py-2">{attributionWording(toAttribution(d.attribution)).label}</td>
                  <td className="px-3 py-2">{d.status}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d._count.chunks}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{d.updatedAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
              {docs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    No approved knowledge loaded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
