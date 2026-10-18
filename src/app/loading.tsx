import { BrandMark } from '@/components/shared/Brand';

export default function Loading() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-black" role="status" aria-label="Loading">
      <div className="animate-pulse">
        <BrandMark size={96} />
      </div>
    </main>
  );
}
