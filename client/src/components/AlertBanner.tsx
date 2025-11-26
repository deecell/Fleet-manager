import { AlertTriangle, X } from "lucide-react";

interface AlertBannerProps {
  title: string;
  description: string;
  onClose?: () => void;
}

export function AlertBanner({ title, description, onClose }: AlertBannerProps) {
  return (
    <div 
      className="bg-[#fff1d4] border border-[#ffd6a7] rounded-[10px] p-4"
      data-testid="alert-banner"
    >
      <div className="flex gap-3">
        <AlertTriangle className="h-4 w-4 text-[#f55200] mt-0.5 flex-shrink-0" />
        <div className="space-y-1 flex-1">
          <p className="text-sm font-medium text-[#f55200]">{title}</p>
          <p className="text-sm text-[#d54700]">{description}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1 rounded hover-elevate active-elevate-2"
            data-testid="button-close-alert"
          >
            <X className="h-4 w-4 text-[#f55200]" />
          </button>
        )}
      </div>
    </div>
  );
}
