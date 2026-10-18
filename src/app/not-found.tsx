import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <p className="text-xs font-semibold tracking-wider text-[#80909D] uppercase">404</p>
        <h1 className="text-xl font-bold text-[#0B1320] mt-1">Page not found</h1>
        <p className="text-sm text-[#586570] mt-2">The page you are looking for does not exist or you do not have access to it.</p>
        <Link href="/" className="inline-block mt-5 px-4 py-2 rounded-lg bg-[#000000] text-white text-sm font-semibold">Go to my workspace</Link>
      </div>
    </main>
  );
}
