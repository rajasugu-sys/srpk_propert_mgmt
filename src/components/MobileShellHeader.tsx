import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface MobileShellHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  children?: React.ReactNode;
}

export const MobileShellHeader: React.FC<MobileShellHeaderProps> = ({
  title,
  subtitle,
  onBack,
  rightSlot,
  children,
}) => {
  return (
    <header className="bg-gradient-to-b from-[#489E44] to-[#3E8E41] text-white px-4 pt-4 pb-8 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer"
              aria-label="Back to Home"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-white truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] text-emerald-50/90 truncate mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
      {children && <div className="mt-3.5">{children}</div>}
    </header>
  );
};
