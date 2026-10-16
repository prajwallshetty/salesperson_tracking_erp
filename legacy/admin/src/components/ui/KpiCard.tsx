import React from 'react';

interface KpiCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon?: React.ReactNode;
  trend?: string;
  className?: string;
}

export default function KpiCard({
  label,
  value,
  subValue,
  icon,
  trend,
  className = '',
}: KpiCardProps) {
  return (
    <div
      className={`bg-white border border-[#CBD2D7] rounded-xl p-5 flex flex-col justify-between transition-all hover:border-[#A9B5BE] ${className}`}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs font-medium text-[#586570] tracking-wide uppercase">{label}</span>
        {icon && (
          <div className="w-8 h-8 rounded-lg bg-[#E6F4DD] text-[#2E6819] flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
      </div>

      <div className="mt-1">
        <div className="text-2xl md:text-[26px] font-bold text-[#0B1320] tracking-tight">{value}</div>
        {(subValue || trend) && (
          <div className="flex items-center gap-2 mt-1.5 text-xs text-[#586570]">
            {trend && <span className="text-[#2E6819] font-medium">{trend}</span>}
            {subValue && <span>{subValue}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
