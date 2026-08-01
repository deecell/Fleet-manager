import { BatteryCharging, Leaf } from "lucide-react";
import dolarIcon from "@assets/dolar.svg";
import trendIcon from "@assets/trend.svg";
import { useQuery } from "@tanstack/react-query";
import { StatCard, useCountUp, formatNumber, formatSmartDecimal } from "./StatCard";

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
    queryKey: ["/api/v1/savings"],
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
        targetNumber={todayCO2Reduction}
        suffix=" lbs"
        decimals={1}
        icon={<Leaf className="h-[24px] w-[24px] text-[#6B6164]" />}
        iconBgColor="bg-[#ECE8E4]"
      />
      <StatCard
        title="Stored Energy Value"
        targetNumber={storedEnergyValue}
        prefix="$ "
        decimals={2}
        alwaysShowDecimals={true}
        icon={<img src={trendIcon} alt="Trend" className="h-[24px] w-[24px]" />}
        iconBgColor="bg-[#EBEFFA]"
      />
    </div>
  );
}
