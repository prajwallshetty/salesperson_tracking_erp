import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-xs md:text-sm',
    lg: 'px-6 py-2.5 text-sm md:text-base',
  }[size];

  let variantClasses = '';
  switch (variant) {
    case 'primary':
      variantClasses =
        'bg-[#081224] text-white hover:bg-[#111F36] active:bg-[#050C17] border border-[#081224] disabled:bg-[#80909D] disabled:border-[#80909D] shadow-none';
      break;
    case 'secondary':
      variantClasses =
        'bg-white text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6] active:bg-[#E8EDEF] disabled:text-[#80909D]';
      break;
    case 'outline':
      variantClasses =
        'bg-transparent text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6] active:bg-[#E8EDEF]';
      break;
    case 'ghost':
      variantClasses =
        'bg-transparent text-[#586570] hover:text-[#0B1320] hover:bg-[#E8EDEF] active:bg-[#DFE5E8]';
      break;
    case 'destructive':
      variantClasses =
        'bg-[#FDF2F2] text-[#991B1B] border border-[#F8C4C4] hover:bg-[#FCE8E8] active:bg-[#FBD5D5]';
      break;
  }

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#081224]/20 disabled:cursor-not-allowed select-none ${sizeClasses} ${variantClasses} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
