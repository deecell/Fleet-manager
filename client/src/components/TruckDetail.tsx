import { TruckWithHistory } from "@shared/schema";
import { X, Battery, Zap, Activity, Thermometer, Check, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useState } from "react";

interface TruckDetailProps {
  truck: TruckWithHistory;
  onClose: () => void;
}

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-[44px] h-[24px] rounded-full relative transition-colors ${
        enabled ? "bg-[#00c950]" : "bg-[#d2d5da]"
      }`}
      data-testid="toggle-switch"
    >
      <div 
        className={`absolute w-[20px] h-[20px] bg-white rounded-full top-[2px] shadow-[0px_2px_4px_0px_rgba(39,39,39,0.1)] transition-all ${
          enabled ? "left-[22px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

function InputField({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[#ebeef2] rounded h-[59px] px-4 py-2 flex flex-col justify-center">
      <p className="text-xs text-[#323941] opacity-80">{label}</p>
      <div className="flex items-center justify-between">
        <p className="text-base text-neutral-950">{value}</p>
      </div>
    </div>
  );
}

function DropdownField({ 
  label, 
  value, 
  options, 
  onValueChange,
  testId
}: { 
  label: string; 
  value: string; 
  options: string[];
  onValueChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <div className="bg-white border border-[#ebeef2] rounded h-[59px] px-4 py-2 flex items-center">
      <div className="flex-1">
        <p className="text-xs text-[#323941] opacity-80">{label}</p>
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="h-auto p-0 border-0 shadow-none focus:ring-0 text-base text-neutral-950 [&>svg]:hidden" data-testid={testId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white">
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ChevronDown className="w-3 h-3 text-[#323941]" />
    </div>
  );
}

export default function TruckDetail({ truck, onClose }: TruckDetailProps) {
  const [voltageSource, setVoltageSource] = useState<"V1" | "V2">("V1");
  const [flipCurrentSign, setFlipCurrentSign] = useState(true);
  const [turnOnAtStartup, setTurnOnAtStartup] = useState(false);
  const [latchRelayOn, setLatchRelayOn] = useState(false);
  const [invertRelayLogic, setInvertRelayLogic] = useState(false);
  const [mfTerminalFunction, setMfTerminalFunction] = useState("Push button input");
  const [dataLoggingMode, setDataLoggingMode] = useState("Every 10 seconds");

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const socData = truck.history.map(d => ({ time: formatTime(d.timestamp), value: d.soc }));
  const voltageData = truck.history.map(d => ({ time: formatTime(d.timestamp), value: d.voltage }));
  const currentData = truck.history.map(d => ({ time: formatTime(d.timestamp), value: d.current }));
  const wattsData = truck.history.map(d => ({ time: formatTime(d.timestamp), value: d.watts }));

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[610px] bg-white shadow-[-1px_0px_22px_-6px_rgba(0,0,0,0.17)] overflow-y-auto z-50">
      {/* Header */}
      <div className="px-[68px] border-b border-[#ebeef2] pt-[19.5px] pb-[19.5px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-[26px] font-medium text-black leading-6 tracking-tight" data-testid="truck-detail-name">
              {truck.name}
            </h2>
            <div 
              className={`h-[27px] px-3 rounded-md flex items-center gap-2 ${
                truck.status === "in-service" 
                  ? "bg-[rgba(0,201,80,0.14)] border border-[#00c950]" 
                  : "bg-[rgba(255,9,0,0.14)] border border-[#ff0900]"
              }`}
              data-testid="truck-detail-status"
            >
              <div className={`w-2 h-2 rounded-full ${
                truck.status === "in-service" ? "bg-[#00c950]" : "bg-[#ff0900]"
              }`} />
              <span className={`text-sm ${
                truck.status === "in-service" ? "text-[#00953b]" : "text-[#ff0900]"
              }`}>
                {truck.status === "in-service" ? "In Service" : "Not in Service"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="hover-elevate active-elevate-2 p-2 rounded-md"
            data-testid="button-close-detail"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <p className="text-base text-[#4a5565]">{truck.model}</p>
          <div className="w-1 h-1 bg-[#4a5565] rounded-full" />
          <p className="text-base text-[#4a5565]">Serial: {truck.serial}</p>
        </div>
      </div>
      {/* Settings Content */}
      <div className="px-[68px] py-8 space-y-6">
        {/* Power Meter Voltage Source */}
        <div className="space-y-4">
          <p className="text-lg font-medium text-neutral-950">Power Meter Voltage Source</p>
          <div className="bg-[#fafbfc] border border-[#ebeef2] rounded-lg h-[48px] p-[6px] shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)] flex">
            <button
              onClick={() => setVoltageSource("V1")}
              className={`flex-1 h-[36px] rounded-md flex items-center justify-center gap-1.5 text-base ${
                voltageSource === "V1" 
                  ? "bg-[#303030] text-white font-semibold border border-[#ebeef2]" 
                  : "text-[#4a5565]"
              }`}
              data-testid="button-voltage-v1"
            >
              {voltageSource === "V1" && <Check className="w-3.5 h-3.5" />}
              V1
            </button>
            <button
              onClick={() => setVoltageSource("V2")}
              className={`flex-1 h-[36px] rounded-md flex items-center justify-center gap-1.5 text-base ${
                voltageSource === "V2" 
                  ? "bg-[#303030] text-white font-semibold border border-[#ebeef2]" 
                  : "text-[#4a5565]"
              }`}
              data-testid="button-voltage-v2"
            >
              {voltageSource === "V2" && <Check className="w-3.5 h-3.5" />}
              V2
            </button>
          </div>
        </div>

        {/* Toggle Options */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-base text-[#4a5565]">Flip Current Sign</p>
            <Toggle enabled={flipCurrentSign} onToggle={() => setFlipCurrentSign(!flipCurrentSign)} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-base text-[#4a5565]">Turn On at Startup</p>
            <Toggle enabled={turnOnAtStartup} onToggle={() => setTurnOnAtStartup(!turnOnAtStartup)} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-base text-[#4a5565]">Latch Relay On</p>
            <Toggle enabled={latchRelayOn} onToggle={() => setLatchRelayOn(!latchRelayOn)} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-base text-[#4a5565]">Invert Relay Logic</p>
            <Toggle enabled={invertRelayLogic} onToggle={() => setInvertRelayLogic(!invertRelayLogic)} />
          </div>
        </div>

        {/* Input Fields */}
        <div className="space-y-4 pt-4">
          <InputField label="Connect Filter (milliseconds)" value="1000" />
          <DropdownField 
            label="MF Terminal Function" 
            value={mfTerminalFunction}
            options={["Push button input", "Toggle switch input", "Momentary switch", "Disabled"]}
            onValueChange={setMfTerminalFunction}
            testId="dropdown-mf-terminal"
          />
          <DropdownField 
            label="Data Logging mode" 
            value={dataLoggingMode}
            options={["Every 10 seconds", "Every 30 seconds", "Every minute", "Every 5 minutes", "Disabled"]}
            onValueChange={setDataLoggingMode}
            testId="dropdown-data-logging"
          />
        </div>

        {/* Current Metrics - moved below Figma content */}
        <div className="pt-8">
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

        {/* Historical Data - moved below Figma content */}
        <div className="pt-4">
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
