import { Truck } from "@shared/schema";
import { Battery, Clock, Wrench, TrendingUp, TrendingDown } from "lucide-react";
import { useState, useEffect, useRef } from "react";

interface FleetStatsProps {
  trucks: Truck[];
}

interface StatCardProps {
  title: string;
  value: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  icon: JSX.Element;
  iconBgColor: string;
  valueColor?: string;
  targetNumber: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

function useCountUp(target: number, duration: number = 1500, decimals: number = 0) {
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

function formatNumber(num: string): string {
  const parts = num.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function StatCard({ title, trend, icon, iconBgColor, valueColor = "text-neutral-950", targetNumber, prefix = "", suffix = "", decimals = 0 }: StatCardProps) {
  const animatedValue = useCountUp(targetNumber, 1500, decimals);
  const formattedValue = formatNumber(animatedValue);

  return (
    <div className="bg-white rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)] p-6 h-[185px] flex flex-col">
      <div className="flex items-start justify-between">
        <div className={`w-[49px] h-[49px] rounded-[9px] flex items-center justify-center ${iconBgColor}`}>
          {icon}
        </div>
        {trend && (
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
      <p className="text-sm text-[#4a5565] mt-[17px]">{title}</p>
      <p className={`text-[30px] font-medium leading-8 mt-3 tracking-tight ${valueColor}`} data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
        {prefix}{formattedValue}{suffix}
      </p>
    </div>
  );
}

function TimeStatCard({ title, trend, icon, iconBgColor, valueColor = "text-neutral-950", hours, minutes }: {
  title: string;
  trend?: { value: string; isPositive: boolean; };
  icon: JSX.Element;
  iconBgColor: string;
  valueColor?: string;
  hours: number;
  minutes: number;
}) {
  const animatedHours = useCountUp(hours, 1500, 0);
  const animatedMinutes = useCountUp(minutes, 1500, 0);

  return (
    <div className="bg-white rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)] p-6 h-[185px] flex flex-col">
      <div className="flex items-start justify-between">
        <div className={`w-[49px] h-[49px] rounded-[9px] flex items-center justify-center ${iconBgColor}`}>
          {icon}
        </div>
        {trend && (
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
      <p className="text-sm text-[#4a5565] mt-[17px]">{title}</p>
      <p className={`text-[30px] font-medium leading-8 mt-3 tracking-tight ${valueColor}`} data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
        {animatedHours.toString().padStart(2, '0')}:{animatedMinutes.toString().padStart(2, '0')} h
      </p>
    </div>
  );
}

export default function FleetStats({ trucks }: FleetStatsProps) {
  const avgSoc = trucks.length > 0 ? trucks.reduce((sum, t) => sum + t.soc, 0) / trucks.length : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Today's Savings"
        value="$ 12,249.05"
        targetNumber={12249.05}
        prefix="$ "
        decimals={2}
        trend={{ value: "$ 582 (14%)", isPositive: true }}
        icon={<TrendingUp className="h-6 w-6 text-[#008236]" />}
        iconBgColor="bg-[#effcdc]"
        valueColor="text-[#008236]"
      />
      <StatCard
        title="Avg. State of charge"
        value={`${avgSoc.toFixed(0)}%`}
        targetNumber={avgSoc}
        suffix="%"
        decimals={0}
        trend={{ value: "2 131kW (14%)", isPositive: true }}
        icon={<Battery className="h-6 w-6 text-[#fa671e]" />}
        iconBgColor="bg-[#fef4e8]"
      />
      <StatCard
        title="Tractor maintenance interval increase"
        value="24%"
        targetNumber={24}
        suffix="%"
        decimals={0}
        trend={{ value: "2 131kW (14%)", isPositive: true }}
        icon={<Wrench className="h-6 w-6 text-[#6b6164]" />}
        iconBgColor="bg-[#ece8e4]"
      />
      <TimeStatCard
        title="Tractor hours offset"
        hours={7}
        minutes={39}
        trend={{ value: "-2:37 (10%)", isPositive: false }}
        icon={<Clock className="h-6 w-6 text-[#6a7fbc]" />}
        iconBgColor="bg-[#e2e8f8]"
      />
    </div>
  );
}
