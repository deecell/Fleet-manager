import { AlertTriangle } from "lucide-react";

interface AlertBannerProps {
  title: string;
  description: string;
}

export function AlertBanner({ title, description }: AlertBannerProps) {
  return (
    <div 
      className="bg-[#fff1d4] border border-[#ffd6a7] rounded-[10px] p-4"
      data-testid="alert-banner"
    >
      <div className="flex gap-3">
        <AlertTriangle className="h-4 w-4 text-[#f55200] mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-[#f55200]">{title}</p>
          <p className="text-sm text-[#d54700]">{description}</p>
        </div>
      </div>
    </div>
  );
}
