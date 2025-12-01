import { Battery, Clock, Wrench, TrendingUp, TrendingDown } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

interface TruckWithSoc {
  soc: number;
}

interface FleetStatsProps {
  trucks: TruckWithSoc[];
}

interface SavingsData {
  todaySavings: number;
  todayWhSolar: number;
  todayGallonsSaved: number;
  last7DaysAverage: number;
  trendPercentage: number;
  trendIsPositive: boolean;
  trendDollarAmount: number;
  currentFuelPrice: number;
}

interface FleetStatsData {
  avgSoc: {
    value: number;
    trend7Day: number;
    trendPercentage: number;
    trendIsPositive: boolean;
  };
  tractorHoursOffset: {
    hours: number;
    minutes: number;
    trend7DayHours: number;
    trend7DayMinutes: number;
    trendPercentage: number;
    trendIsPositive: boolean;
    hasInsufficientData?: boolean;
  };
  maintenanceIntervalIncrease: {
    value: number;
    trend7Day: number;
    trendPercentage: number;
    trendIsPositive: boolean;
    hasInsufficientData?: boolean;
  };
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
  hasInsufficientData?: boolean;
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

function StatCard({ title, trend, icon, iconBgColor, valueColor = "text-neutral-950", targetNumber, prefix = "", suffix = "", decimals = 0, hasInsufficientData = false }: StatCardProps) {
  const animatedValue = useCountUp(targetNumber, 1500, decimals);
  const formattedValue = formatNumber(animatedValue);

  return (
    <div className="bg-white rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)] p-6 h-[185px] flex flex-col">
      <div className="flex items-center justify-between">
        <div className={`w-[49px] h-[49px] rounded-[9px] flex items-center justify-center ${iconBgColor}`}>
          {icon}
        </div>
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
      <p className="text-sm text-[#4a5565] mt-[17px]">{title}</p>
      {hasInsufficientData ? (
        <p className="text-[18px] min-[1440px]:text-[20px] leading-8 mt-3 tracking-tight text-[#9ca3af] font-light" data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
          Awaiting data...
        </p>
      ) : (
        <p className={`text-[26px] min-[1440px]:text-[30px] font-medium leading-8 mt-3 tracking-tight ${valueColor}`} data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
          {prefix}{formattedValue}{suffix}
        </p>
      )}
    </div>
  );
}

function TimeStatCard({ title, trend, icon, iconBgColor, valueColor = "text-neutral-950", hours, minutes, hasInsufficientData = false }: {
  title: string;
  trend?: { value: string; isPositive: boolean; };
  icon: JSX.Element;
  iconBgColor: string;
  valueColor?: string;
  hours: number;
  minutes: number;
  hasInsufficientData?: boolean;
}) {
  const animatedHours = useCountUp(hours, 1500, 0);
  const animatedMinutes = useCountUp(minutes, 1500, 0);

  return (
    <div className="bg-white rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)] p-6 h-[185px] flex flex-col">
      <div className="flex items-center justify-between">
        <div className={`w-[49px] h-[49px] rounded-[9px] flex items-center justify-center ${iconBgColor}`}>
          {icon}
        </div>
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
      <p className="text-sm text-[#4a5565] mt-[17px]">{title}</p>
      {hasInsufficientData ? (
        <p className="text-[18px] min-[1440px]:text-[20px] leading-8 mt-3 tracking-tight text-[#9ca3af] font-light" data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
          Awaiting data...
        </p>
      ) : (
        <p className={`text-[26px] min-[1440px]:text-[30px] font-medium leading-8 mt-3 tracking-tight ${valueColor}`} data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
          {animatedHours.toString().padStart(2, '0')}:{animatedMinutes.toString().padStart(2, '0')} h
        </p>
      )}
    </div>
  );
}

export default function FleetStats({ trucks }: FleetStatsProps) {
  const { data: savingsData } = useQuery<SavingsData>({
    queryKey: ["/api/v1/savings"],
    refetchInterval: 60000,
  });

  const { data: fleetStats } = useQuery<FleetStatsData>({
    queryKey: ["/api/v1/fleet-stats"],
    refetchInterval: 60000,
  });

  const todaySavings = savingsData?.todaySavings ?? 0;
  const trendDollar = savingsData?.trendDollarAmount ?? 0;
  const trendPercent = savingsData?.trendPercentage ?? 0;
  const trendIsPositive = savingsData?.trendIsPositive ?? true;

  const formatSavingsTrend = () => {
    const dollarStr = `$ ${Math.abs(trendDollar).toFixed(0)}`;
    const percentStr = `(${Math.abs(trendPercent)}%)`;
    return `${trendIsPositive ? '+' : '-'}${dollarStr} ${percentStr} vs 7d`;
  };

  const avgSoc = fleetStats?.avgSoc.value ?? (trucks.length > 0 ? trucks.reduce((sum, t) => sum + t.soc, 0) / trucks.length : 0);
  const socTrendPercent = fleetStats?.avgSoc.trendPercentage ?? 0;
  const socTrendIsPositive = fleetStats?.avgSoc.trendIsPositive ?? true;
  const soc7DayAvg = fleetStats?.avgSoc.trend7Day ?? 0;

  const formatSocTrend = () => {
    const diff = avgSoc - soc7DayAvg;
    return `${socTrendIsPositive ? '+' : '-'}${Math.abs(diff).toFixed(0)}% (${socTrendPercent}%) vs 7d`;
  };

  const maintenanceValue = fleetStats?.maintenanceIntervalIncrease.value ?? 0;
  const maintenanceTrendPercent = fleetStats?.maintenanceIntervalIncrease.trendPercentage ?? 0;
  const maintenanceTrendIsPositive = fleetStats?.maintenanceIntervalIncrease.trendIsPositive ?? true;
  const maintenance7DayAvg = fleetStats?.maintenanceIntervalIncrease.trend7Day ?? 0;

  const formatMaintenanceTrend = () => {
    const diff = maintenanceValue - maintenance7DayAvg;
    return `${maintenanceTrendIsPositive ? '+' : '-'}${Math.abs(diff)}% (${maintenanceTrendPercent}%) vs 7d`;
  };

  const hoursOffset = fleetStats?.tractorHoursOffset.hours ?? 0;
  const minutesOffset = fleetStats?.tractorHoursOffset.minutes ?? 0;
  const hoursTrendPercent = fleetStats?.tractorHoursOffset.trendPercentage ?? 0;
  const hoursTrendIsPositive = fleetStats?.tractorHoursOffset.trendIsPositive ?? true;
  const hours7DayAvg = fleetStats?.tractorHoursOffset.trend7DayHours ?? 0;
  const minutes7DayAvg = fleetStats?.tractorHoursOffset.trend7DayMinutes ?? 0;
  const hoursHasInsufficientData = fleetStats?.tractorHoursOffset.hasInsufficientData ?? true;
  const maintenanceHasInsufficientData = fleetStats?.maintenanceIntervalIncrease.hasInsufficientData ?? true;

  const formatHoursTrend = () => {
    const todayTotal = hoursOffset + minutesOffset / 60;
    const avgTotal = hours7DayAvg + minutes7DayAvg / 60;
    const diffHours = Math.abs(todayTotal - avgTotal);
    const diffH = Math.floor(diffHours);
    const diffM = Math.round((diffHours - diffH) * 60);
    return `${hoursTrendIsPositive ? '+' : '-'}${diffH}:${diffM.toString().padStart(2, '0')} (${hoursTrendPercent}%) vs 7d`;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Today's Savings"
        value={`$ ${todaySavings.toFixed(2)}`}
        targetNumber={todaySavings}
        prefix="$ "
        decimals={2}
        trend={{ 
          value: formatSavingsTrend(), 
          isPositive: trendIsPositive 
        }}
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
        trend={{ 
          value: formatSocTrend(), 
          isPositive: socTrendIsPositive 
        }}
        icon={<Battery className="h-6 w-6 text-[#778AC2]" />}
        iconBgColor="bg-[#EBEFFA]"
      />
      <StatCard
        title="Tractor maintenance interval increase"
        value={`${maintenanceValue}%`}
        targetNumber={maintenanceValue}
        suffix="%"
        decimals={0}
        trend={{ 
          value: formatMaintenanceTrend(), 
          isPositive: maintenanceTrendIsPositive 
        }}
        icon={<Wrench className="h-6 w-6 text-[#778AC2]" />}
        iconBgColor="bg-[#EBEFFA]"
        hasInsufficientData={maintenanceHasInsufficientData}
      />
      <TimeStatCard
        title="Tractor hours offset"
        hours={hoursOffset}
        minutes={minutesOffset}
        trend={{ 
          value: formatHoursTrend(), 
          isPositive: hoursTrendIsPositive 
        }}
        icon={<Clock className="h-6 w-6 text-[#778AC2]" />}
        iconBgColor="bg-[#EBEFFA]"
        hasInsufficientData={hoursHasInsufficientData}
      />
    </div>
  );
}
