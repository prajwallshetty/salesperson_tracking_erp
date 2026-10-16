import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface BackLinkProps {
  href: string;
  label?: string;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export default function BackLink({
  href,
  label = 'Back to dashboard',
  className = '',
  onClick,
}: BackLinkProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`inline-flex items-center gap-2 text-xs md:text-sm font-medium text-[#586570] hover:text-[#0B1320] transition-colors mb-4 group ${className}`}
    >
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
      <span>{label}</span>
    </Link>
  );
}
