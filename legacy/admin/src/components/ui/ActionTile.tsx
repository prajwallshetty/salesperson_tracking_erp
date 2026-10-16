import React from 'react';

interface ActionTileProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

export default function ActionTile({
  icon,
  title,
  description,
  onClick,
  selected = false,
  className = '',
}: ActionTileProps) {
  return (
    <div
      onClick={onClick}
      className={`border rounded-xl p-5 text-left transition-all cursor-pointer flex items-start gap-4 ${
        selected
          ? 'bg-white border-[#081224] ring-1 ring-[#081224]'
          : 'bg-white border-[#CBD2D7] hover:border-[#80909D]'
      } ${className}`}
    >
      <div className="w-9 h-9 rounded-lg bg-[#E6F4DD] text-[#2E6819] flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-[#0B1320]">{title}</h3>
        <p className="text-xs text-[#586570] mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
