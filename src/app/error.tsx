'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-[60vh] flex items-center justify-center p-6">
      <div role="alert" className="text-center max-w-sm">
        <h1 className="text-lg font-bold text-[#0B1320]">Something went wrong</h1>
        <p className="text-sm text-[#586570] mt-2">The page failed to load. Your data has not been changed.{error.digest ? ` (ref ${error.digest})` : ''}</p>
        <button onClick={reset} className="mt-5 px-4 py-2 rounded-lg bg-[#000000] text-white text-sm font-semibold">Try again</button>
      </div>
    </main>
  );
}
