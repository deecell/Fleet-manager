import { DeviceWarning, DeviceWarningType } from "@/lib/api";
import { 
  AlertTriangle, 
  WifiOff, 
  Clock, 
  Battery, 
  Zap,
  AlertCircle 
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DeviceWarningIndicatorProps {
  warnings: DeviceWarning[];
  showAll?: boolean;
  size?: "sm" | "md";
}

const warningIcons: Record<DeviceWarningType, typeof AlertTriangle> = {
  offline: WifiOff,
  stale: Clock,
  low_battery: Battery,
  low_voltage: Zap,
  unstable: AlertCircle,
};

const warningLabels: Record<DeviceWarningType, string> = {
  offline: "Device Offline",
  stale: "Stale Data",
  low_battery: "Low Battery",
  low_voltage: "Low Voltage",
  unstable: "Unstable Connection",
};

export function DeviceWarningIndicator({ 
  warnings, 
  showAll = false,
  size = "md" 
}: DeviceWarningIndicatorProps) {
  if (!warnings || warnings.length === 0) {
    return null;
  }

  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  const criticalWarnings = warnings.filter(w => w.severity === "critical");
  const regularWarnings = warnings.filter(w => w.severity === "warning");
  
  const sortedWarnings = [...criticalWarnings, ...regularWarnings];
  const displayWarnings = showAll ? sortedWarnings : sortedWarnings.slice(0, 1);
  const hasCritical = criticalWarnings.length > 0;

  const tooltipContent = sortedWarnings.map(w => w.message).join("\n");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className="flex items-center gap-1"
          data-testid="device-warning-indicator"
        >
          {displayWarnings.map((warning, index) => {
            const Icon = warningIcons[warning.type] || AlertTriangle;
            const isCritical = warning.severity === "critical";
            
            return (
              <div
                key={`${warning.type}-${index}`}
                className={`flex items-center ${
                  isCritical ? "text-[#dc2626]" : "text-[#f59e0b]"
                }`}
                data-testid={`warning-icon-${warning.type}`}
              >
                <Icon className={iconSize} />
              </div>
            );
          })}
          {!showAll && sortedWarnings.length > 1 && (
            <span 
              className={`text-xs font-medium ${
                hasCritical ? "text-[#dc2626]" : "text-[#f59e0b]"
              }`}
              data-testid="warning-count"
            >
              +{sortedWarnings.length - 1}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent 
        side="top" 
        className="max-w-xs"
        data-testid="warning-tooltip"
      >
        <div className="space-y-1">
          {sortedWarnings.map((warning, index) => {
            const Icon = warningIcons[warning.type] || AlertTriangle;
            const isCritical = warning.severity === "critical";
            
            return (
              <div 
                key={`${warning.type}-${index}`}
                className={`flex items-center gap-2 text-sm ${
                  isCritical ? "text-[#dc2626]" : "text-[#f59e0b]"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{warning.message}</span>
              </div>
            );
          })}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function DeviceStatusBadge({ 
  connectionStatus,
  dataStatus,
}: { 
  connectionStatus?: string;
  dataStatus?: string;
}) {
  if (connectionStatus === "online" && dataStatus === "reporting") {
    return (
      <span 
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#dcfce7] text-[#15803d]"
        data-testid="status-badge-online"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
        Online
      </span>
    );
  }

  if (connectionStatus === "offline") {
    return (
      <span 
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#fef2f2] text-[#dc2626]"
        data-testid="status-badge-offline"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
        Offline
      </span>
    );
  }

  if (connectionStatus === "unstable") {
    return (
      <span 
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#fef3c7] text-[#d97706]"
        data-testid="status-badge-unstable"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
        Unstable
      </span>
    );
  }

  if (dataStatus === "stale") {
    return (
      <span 
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#fef3c7] text-[#d97706]"
        data-testid="status-badge-stale"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
        Stale
      </span>
    );
  }

  return (
    <span 
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#f3f4f6] text-[#6b7280]"
      data-testid="status-badge-unknown"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#9ca3af]" />
      Unknown
    </span>
  );
}
