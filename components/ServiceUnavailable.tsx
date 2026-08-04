import Link from 'next/link';

/** Soft landing when Prisma Postgres is unreachable / pool-exhausted. */
export default function ServiceUnavailable({
  title = 'Jackie is briefly unavailable',
  detail = 'We could not reach the database just now. This is usually a short network blip — wait a few seconds and refresh.',
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <main
      className="min-h-[70vh] flex flex-col items-center justify-center px-6 text-center"
      style={{ color: 'var(--pi-silver-300)' }}
    >
      <h1
        className="m-0 text-xl font-semibold"
        style={{ color: '#fff' }}
      >
        {title}
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed">{detail}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link href="/voice" className="btn-primary inline-flex px-4 py-2 text-sm">
          Try voice again
        </Link>
        <Link href="/chat" className="btn-secondary inline-flex px-4 py-2 text-sm">
          Open text chat
        </Link>
      </div>
    </main>
  );
}
