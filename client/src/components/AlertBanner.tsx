import { AlertTriangle, X } from "lucide-react";

interface AlertBannerProps {
  title: string;
  description: string;
  truckName?: string;
  onTruckClick?: () => void;
  onClose?: () => void;
}

export function AlertBanner({ title, description, truckName, onTruckClick, onClose }: AlertBannerProps) {
  const renderDescription = () => {
    if (!truckName || !onTruckClick) {
      return <p className="text-sm text-[#d54700]">{description}</p>;
    }
    
    const parts = description.split(truckName);
    if (parts.length === 1) {
      return <p className="text-sm text-[#d54700]">{description}</p>;
    }
    
    return (
      <p className="text-sm text-[#d54700]">
        {parts[0]}
        <button
          onClick={onTruckClick}
          className="font-medium underline hover:text-[#f55200] cursor-pointer"
          data-testid="link-alert-truck"
        >
          {truckName}
        </button>
        {parts.slice(1).join(truckName)}
      </p>
    );
  };

  return (
    <div 
      className="bg-[#fff1d4] border border-[#ffd6a7] rounded-[10px] p-4"
      data-testid="alert-banner"
    >
      <div className="flex gap-3">
        <AlertTriangle className="h-4 w-4 text-[#f55200] mt-0.5 flex-shrink-0" />
        <div className="space-y-1 flex-1">
          <p className="text-sm font-medium text-[#f55200]">{title}</p>
          {renderDescription()}
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
