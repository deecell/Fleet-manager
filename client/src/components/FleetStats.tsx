import { BatteryCharging, TrendingUp, TrendingDown, Leaf } from "lucide-react";
import dolarIcon from "@assets/dolar.svg";
import trendIcon from "@assets/trend.svg";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

interface TruckWithSoc {
  soc: number;
  wh: number;
  fuelSavings?: number;
  todayParkedMinutes?: number;
}

interface FleetStatsProps {
  trucks: TruckWithSoc[];
}

interface FleetStatsData {
  avgSoc: {
    value: number;
    trend7Day: number;
    trendPercentage: number;
    trendIsPositive: boolean;
  };
  maintenanceIntervalIncrease: {
    value: number;
    trend7Day: number;
    trendPercentage: number;
    trendIsPositive: boolean;
    hasInsufficientData?: boolean;
  };
}

interface SavingsData {
  todaySavings: number;
  todayGallonsSaved: number;
  todayCO2Reduction: number;
  todayParkedMinutes: number;
  mtdSavings: number;
  mtdGallonsSaved: number;
  mtdCO2Reduction: number;
  mtdParkedMinutes: number;
  currentFuelPrice: number;
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
  alwaysShowDecimals?: boolean;
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

function formatSmartDecimal(value: number, maxDecimals: number = 1): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  const fixed = value.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, '');
}

function formatSmartString(value: string): string {
  return value.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function StatCard({ title, trend, icon, iconBgColor, valueColor = "text-neutral-950", targetNumber, prefix = "", suffix = "", decimals = 0, hasInsufficientData = false, alwaysShowDecimals = false }: StatCardProps) {
  const animatedValue = useCountUp(targetNumber, 1500, decimals);
  const formattedValue = alwaysShowDecimals ? formatNumber(animatedValue) : formatSmartString(formatNumber(animatedValue));

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
        <p className="text-[26px] min-[1440px]:text-[30px] font-medium leading-8 mt-3 tracking-tight text-[#0a0a0a]" data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
          {prefix}{formattedValue}{suffix}
        </p>
      )}
    </div>
  );
}

interface SavingsCardProps {
  todaySavings: number;
  mtdSavings: number;
  icon: JSX.Element;
  iconBgColor: string;
}

function SavingsCard({ todaySavings, mtdSavings, icon, iconBgColor }: SavingsCardProps) {
  const animatedMtd = useCountUp(mtdSavings, 1500, 2);
  const formattedMtd = formatNumber(animatedMtd);
  
  return (
    <div className="bg-white rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)] p-6 h-[185px] flex flex-col" data-testid="card-total-savings">
      <div className="flex items-center justify-between">
        <div className={`w-[49px] h-[49px] rounded-[9px] flex items-center justify-center ${iconBgColor}`}>
          {icon}
        </div>
        <div className="text-[#39c900] text-center whitespace-nowrap">
          <span className="font-medium text-[19px]">${Math.round(todaySavings)} </span>
          <span className="text-[12px]">today</span>
        </div>
      </div>
      <p className="text-sm text-[#4a5565] mt-[17px]">Total Savings</p>
      <div className="flex items-baseline gap-2 mt-3">
        <p className="text-[26px] min-[1440px]:text-[30px] font-medium leading-8 tracking-tight text-[#0a0a0a]" data-testid="stat-total-savings">
          $ {formattedMtd}
        </p>
        <span className="text-[12px] text-[#4a5565]">This month</span>
      </div>
    </div>
  );
}

// Constants for fuel savings calculation
const GALLONS_PER_HOUR_IDLING = 1.2;
const CO2_LBS_PER_GALLON = 22.4;

export default function FleetStats({ trucks }: FleetStatsProps) {
  const { data: fleetStats } = useQuery<FleetStatsData>({
    queryKey: ["/api/v1/fleet-stats"],
    refetchInterval: 60000,
  });

  // Fetch savings data from API for accurate monthly calculations
  const { data: savingsData } = useQuery<SavingsData>({
    queryKey: ["/api/v1/fleet/savings"],
    refetchInterval: 60000,
  });

  // Calculate fallback savings from truck props
  const truckBasedSavings = trucks.reduce((sum, truck) => sum + (truck.fuelSavings ?? 0), 0);
  const truckBasedParkedMinutes = trucks.reduce((sum, truck) => sum + (truck.todayParkedMinutes ?? 0), 0);
  
  // Use API data if available and non-zero, otherwise fallback to truck-based calculation
  const todaySavings = (savingsData?.todaySavings && savingsData.todaySavings > 0) 
    ? savingsData.todaySavings 
    : truckBasedSavings;
  
  // For MTD, use API data if available, otherwise estimate as 30x today (placeholder until real data accumulates)
  const mtdSavings = (savingsData?.mtdSavings && savingsData.mtdSavings > 0) 
    ? savingsData.mtdSavings 
    : todaySavings * 30;
  
  // CO2 Reduction from API or calculate from parked minutes
  const todayCO2Reduction = (savingsData?.todayCO2Reduction && savingsData.todayCO2Reduction > 0) 
    ? savingsData.todayCO2Reduction 
    : (() => {
        const todayParkedHours = truckBasedParkedMinutes / 60;
        const todayGallonsSaved = todayParkedHours * GALLONS_PER_HOUR_IDLING;
        return todayGallonsSaved * CO2_LBS_PER_GALLON;
      })();

  const avgSoc = fleetStats?.avgSoc.value ?? (trucks.length > 0 ? trucks.reduce((sum, t) => sum + t.soc, 0) / trucks.length : 0);
  const socTrendPercent = fleetStats?.avgSoc.trendPercentage ?? 0;
  const socTrendIsPositive = fleetStats?.avgSoc.trendIsPositive ?? true;
  const soc7DayAvg = fleetStats?.avgSoc.trend7Day ?? 0;

  const formatSocTrend = () => {
    const diff = avgSoc - soc7DayAvg;
    return `${socTrendIsPositive ? '+' : '-'}${formatSmartDecimal(Math.abs(diff), 2)}% (${socTrendPercent}%) vs 7d`;
  };

  // Calculate Stored Energy Value: sum of kWh × $0.80
  const ENERGY_PRICE_PER_KWH = 0.80;
  const totalKwh = trucks.reduce((sum, t) => sum + (t.wh || 0), 0);
  const storedEnergyValue = totalKwh * ENERGY_PRICE_PER_KWH;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <SavingsCard
        todaySavings={todaySavings}
        mtdSavings={mtdSavings}
        icon={<img src={dolarIcon} alt="Dollar" className="h-[24px] w-[24px]" />}
        iconBgColor="bg-[#effcdc]"
      />
      <StatCard
        title="Avg. State of Charge"
        value={`${formatSmartDecimal(avgSoc, 2)}%`}
        targetNumber={avgSoc}
        suffix="%"
        decimals={2}
        trend={{ 
          value: formatSocTrend(), 
          isPositive: socTrendIsPositive 
        }}
        icon={<BatteryCharging className="h-[24px] w-[24px] text-[#FA671E]" />}
        iconBgColor="bg-[#fef4e8]"
      />
      <StatCard
        title="CO₂ Reduction"
        value={`${todayCO2Reduction.toFixed(1)} lbs`}
        targetNumber={todayCO2Reduction}
        suffix=" lbs"
        decimals={1}
        icon={<Leaf className="h-[24px] w-[24px] text-[#6B6164]" />}
        iconBgColor="bg-[#ECE8E4]"
        valueColor="text-[#008236]"
      />
      <StatCard
        title="Stored Energy Value"
        value={`$ ${storedEnergyValue.toFixed(2)}`}
        targetNumber={storedEnergyValue}
        prefix="$ "
        decimals={2}
        alwaysShowDecimals={true}
        icon={<img src={trendIcon} alt="Trend" className="h-[24px] w-[24px]" />}
        iconBgColor="bg-[#EBEFFA]"
        valueColor="text-[#008236]"
      />
    </div>
  );
}
