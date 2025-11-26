import { Truck } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Battery, Wrench, Clock } from "lucide-react";

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

function StatCard({ title, value, trend, icon, iconBgColor, valueColor = "text-foreground" }: StatCardProps) {
  return (
    <Card className="p-6 relative">
      <div className="flex items-start justify-between">
        <div className={`w-[49px] h-[49px] rounded-[9px] flex items-center justify-center ${iconBgColor}`}>
          {icon}
        </div>
        {trend && (
          <div className="flex items-center gap-0.5">
            {trend.isPositive ? (
              <TrendingUp className="h-3 w-4 text-[#39c900]" />
            ) : (
              <TrendingDown className="h-3 w-4 text-[#ff0900]" />
            )}
            <span className={`text-xs ${trend.isPositive ? "text-[#39c900]" : "text-[#ff0900]"}`}>
              {trend.value}
            </span>
          </div>
        )}
      </div>
      <p className="text-sm text-[#4a5565] mt-4">{title}</p>
      <p className={`text-[30px] font-medium leading-8 mt-2 tracking-tight ${valueColor}`} data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
        {value}
      </p>
    </Card>
  );
}

export default function FleetStats({ trucks }: FleetStatsProps) {
  const activeTrucks = trucks.filter(t => t.status === "in-service").length;
  const avgSoc = trucks.length > 0 ? trucks.reduce((sum, t) => sum + t.soc, 0) / trucks.length : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Today's Savings"
        value="12,249.05 USD"
        trend={{ value: "$ 582 (14%)", isPositive: true }}
        icon={<TrendingUp className="h-6 w-6 text-[#008236]" style={{ transform: 'scaleY(-1)' }} />}
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
