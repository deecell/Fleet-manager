import { TrendingUp, TrendingDown } from "lucide-react";
import { useState, useEffect, useRef } from "react";

export type StatCardStatus = "good" | "warning" | "critical";

const STATUS_STYLES: Record<StatCardStatus, { bg: string; border: string; text: string; iconBg: string }> = {
  good: {
    bg: "bg-[rgba(0,201,80,0.06)]",
    border: "border-[#00c950]",
    text: "text-[#00953b]",
    iconBg: "bg-[rgba(0,201,80,0.14)]",
  },
  warning: {
    bg: "bg-[rgba(245,158,11,0.06)]",
    border: "border-[#f59e0b]",
    text: "text-[#b45309]",
    iconBg: "bg-[rgba(245,158,11,0.14)]",
  },
  critical: {
    bg: "bg-[rgba(255,9,0,0.06)]",
    border: "border-[#ff0900]",
    text: "text-[#ff0900]",
    iconBg: "bg-[rgba(255,9,0,0.14)]",
  },
};

export function getSocStatus(value: number): StatCardStatus {
  if (value < 15) return "critical";
  if (value < 25) return "warning";
  return "good";
}

export function getVoltageStatus(value: number): StatCardStatus {
  if (value < 11.5 || value > 14.5) return "critical";
  if (value < 12.0 || value > 14.0) return "warning";
  return "good";
}

export function useCountUp(target: number, duration: number = 1500, decimals: number = 0) {
  const [count, setCount] = useState(0);
  const startTime = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);

  useEffect(() => {
    const animate = (timestamp: number) => {
      if (startTime.current === null) {
        startTime.current = timestamp;
      }

      const progress = Math.min((timestamp - startTime.current) / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentValue = easeOutQuart * target;

      setCount(currentValue);

      if (progress < 1) {
        animationFrame.current = requestAnimationFrame(animate);
      }
    };

    animationFrame.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [target, duration]);

  return decimals > 0 ? count.toFixed(decimals) : Math.floor(count).toString();
}

export function formatNumber(num: string): string {
  const parts = num.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

export function formatSmartDecimal(value: number, maxDecimals: number = 1): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  const fixed = value.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, '');
}

function formatSmartString(value: string): string {
  return value.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

export interface StatCardProps {
  title: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  icon?: JSX.Element;
  iconBgColor?: string;
  targetNumber: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  hasInsufficientData?: boolean;
  alwaysShowDecimals?: boolean;
  status?: StatCardStatus;
  caption?: string;
  compact?: boolean;
}

export function StatCard({
  title,
  trend,
  icon,
  iconBgColor = "bg-[#f2f4f7]",
  targetNumber,
  prefix = "",
  suffix = "",
  decimals = 0,
  hasInsufficientData = false,
  alwaysShowDecimals = false,
  status,
  caption,
  compact = false,
}: StatCardProps) {
  const animatedValue = useCountUp(targetNumber, 1500, decimals);
  const formattedValue = alwaysShowDecimals ? formatNumber(animatedValue) : formatSmartString(formatNumber(animatedValue));
  const statusStyle = status ? STATUS_STYLES[status] : null;

  return (
    <div
      className={`rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)] flex flex-col ${
        compact ? "p-3" : "p-6 h-[185px]"
      } ${statusStyle ? `${statusStyle.bg} border-l-4 ${statusStyle.border}` : "bg-white"}`}
    >
      <div className="flex items-center justify-between">
        {icon && (
          <div
            className={`${compact ? "w-8 h-8 rounded-lg" : "w-[49px] h-[49px] rounded-[9px]"} flex items-center justify-center ${
              statusStyle ? statusStyle.iconBg : iconBgColor
            }`}
          >
            {icon}
          </div>
        )}
        {!hasInsufficientData && trend && (
          <div className="flex items-center gap-1">
            {trend.isPositive ? (
              <TrendingUp className="h-4 w-4 text-[#39c900]" />
            ) : (
              <TrendingDown className="h-4 w-4 text-[#ff0900]" />
            )}
            <span className={`text-xs font-normal ${trend.isPositive ? "text-[#39c900]" : "text-[#ff0900]"}`}>
              {trend.value}
            </span>
          </div>
        )}
      </div>
      <p className={`${compact ? "text-xs mt-2" : "text-sm mt-[17px]"} text-[#4a5565]`}>{title}</p>
      {hasInsufficientData ? (
        <p
          className={`${compact ? "text-base mt-1" : "text-[18px] min-[1440px]:text-[20px] mt-3"} leading-8 tracking-tight text-[#9ca3af] font-light`}
          data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          Awaiting data...
        </p>
      ) : (
        <p
          className={`${compact ? "text-lg mt-1" : "text-[26px] min-[1440px]:text-[30px] mt-3"} font-medium leading-8 tracking-tight ${
            statusStyle ? statusStyle.text : "text-[#0a0a0a]"
          }`}
          data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {prefix}{formattedValue}{suffix}
        </p>
      )}
      {caption && <p className="text-[11px] text-muted-foreground mt-1">{caption}</p>}
    </div>
  );
}
