import { Truck } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TruckIcon, Battery, Clock, CheckCircle2 } from "lucide-react";

interface FleetStatsProps {
  trucks: Truck[];
}

export default function FleetStats({ trucks }: FleetStatsProps) {
  const totalTrucks = trucks.length;
  const activeTrucks = trucks.filter(t => t.status === "in-service").length;
  const avgSoc = trucks.reduce((sum, t) => sum + t.soc, 0) / trucks.length;
  const totalRuntime = trucks.reduce((sum, t) => sum + t.runtime, 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Trucks</CardTitle>
          <TruckIcon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold" data-testid="stat-total-trucks">{totalTrucks}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Active Trucks</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-primary" data-testid="stat-active-trucks">{activeTrucks}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {((activeTrucks / totalTrucks) * 100).toFixed(0)}% of fleet
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Avg State of Charge</CardTitle>
          <Battery className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold" data-testid="stat-avg-soc">{avgSoc.toFixed(0)}%</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Runtime</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold" data-testid="stat-total-runtime">{totalRuntime.toFixed(0)}h</div>
        </CardContent>
      </Card>
    </div>
  );
}
