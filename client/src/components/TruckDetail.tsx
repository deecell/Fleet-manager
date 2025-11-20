import { TruckWithHistory } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Zap, Battery, Thermometer, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface TruckDetailProps {
  truck: TruckWithHistory;
  onClose: () => void;
}

export default function TruckDetail({ truck, onClose }: TruckDetailProps) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const socData = truck.history.map(d => ({ time: formatTime(d.timestamp), value: d.soc }));
  const voltageData = truck.history.map(d => ({ time: formatTime(d.timestamp), value: d.voltage }));
  const currentData = truck.history.map(d => ({ time: formatTime(d.timestamp), value: d.current }));
  const wattsData = truck.history.map(d => ({ time: formatTime(d.timestamp), value: d.watts }));

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[600px] lg:w-[700px] bg-background border-l border-border shadow-xl overflow-y-auto z-50">
      <div className="sticky top-0 bg-background border-b border-border p-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold" data-testid="truck-detail-name">{truck.name}</h2>
            <Badge
              variant={truck.status === "in-service" ? "default" : "destructive"}
              data-testid="truck-detail-status"
            >
              <div className={`w-2 h-2 rounded-full mr-1.5 ${
                truck.status === "in-service" ? "bg-green-500" : "bg-red-500"
              }`}></div>
              {truck.status === "in-service" ? "In Service" : "Not in Service"}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">{truck.model} • Serial: {truck.serial}</p>
        </div>
        <button
          onClick={onClose}
          className="hover-elevate active-elevate-2 p-2 rounded-md"
          data-testid="button-close-detail"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-4">Current Metrics</h3>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">State of Charge</CardTitle>
                <Battery className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="metric-soc">{truck.soc.toFixed(0)}%</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Voltage</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="metric-voltage">{truck.v1.toFixed(2)}V</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Current</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="metric-current">{truck.ah.toFixed(1)}Ah</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Power</CardTitle>
                <Thermometer className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="metric-power">{truck.p.toFixed(1)}kW</div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4">Historical Data</h3>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">State of Charge (%)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={socData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }}
                    />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Voltage (V)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={voltageData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }}
                    />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Current (A)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={currentData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }}
                    />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Power (W)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={wattsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }}
                    />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
