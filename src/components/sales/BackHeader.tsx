import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export default function BackHeader({ title, href = '/field/more' }: { title: string; href?: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <Link href={href} className="p-2 -ml-2 rounded-lg hover:bg-white" aria-label="Back">
        <ChevronLeft className="w-5 h-5" />
      </Link>
      <h1 className="text-lg font-bold text-[#0B1320]">{title}</h1>
    </div>
  );
}
