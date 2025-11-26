import { Truck } from "@shared/schema";
import { Battery, Clock, Wrench, TrendingUp, TrendingDown } from "lucide-react";

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
}

function StatCard({ title, value, trend, icon, iconBgColor, valueColor = "text-neutral-950" }: StatCardProps) {
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
        {value}
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
        value="12,249.05 USD"
        trend={{ value: "$ 582 (14%)", isPositive: true }}
        icon={<TrendingUp className="h-6 w-6 text-[#008236]" />}
        iconBgColor="bg-[#effcdc]"
        valueColor="text-[#008236]"
      />
      <StatCard
        title="Avg. State of charge"
        value={`${avgSoc.toFixed(0)}%`}
        trend={{ value: "2 131kW (14%)", isPositive: true }}
        icon={<Battery className="h-6 w-6 text-[#fa671e]" />}
        iconBgColor="bg-[#fef4e8]"
      />
      <StatCard
        title="Tractor maintenance interval increase"
        value="24%"
        trend={{ value: "2 131kW (14%)", isPositive: true }}
        icon={<Wrench className="h-6 w-6 text-[#6b6164]" />}
        iconBgColor="bg-[#ece8e4]"
      />
      <StatCard
        title="Tractor hours offset"
        value="07:39 h"
        trend={{ value: "-2:37 (10%)", isPositive: false }}
        icon={<Clock className="h-6 w-6 text-[#6a7fbc]" />}
        iconBgColor="bg-[#e2e8f8]"
      />
    </div>
  );
}
