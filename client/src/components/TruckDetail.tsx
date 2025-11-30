import { TruckWithHistory, Notification, HistoricalDataPoint } from "@shared/schema";
import { X, Battery, Zap, Activity, Thermometer, Check, ChevronDown, AlertTriangle, Loader2, Download, Calendar, Plus, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useState } from "react";
import { useTruckHistory, LegacyTruckWithDevice } from "@/lib/api";
import { TruckTimeline } from "./TruckTimeline";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, subDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface TruckDetailProps {
  truck: LegacyTruckWithDevice;
  onClose: () => void;
  alert?: Notification;
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

export default function TruckDetail({ truck, onClose, alert }: TruckDetailProps) {
  const { toast } = useToast();
  const [voltageSource, setVoltageSource] = useState<"V1" | "V2">("V1");
  const [flipCurrentSign, setFlipCurrentSign] = useState(true);
  const [turnOnAtStartup, setTurnOnAtStartup] = useState(false);
  const [latchRelayOn, setLatchRelayOn] = useState(false);
  const [invertRelayLogic, setInvertRelayLogic] = useState(false);
  const [mfTerminalFunction, setMfTerminalFunction] = useState("Push button input");
  const [dataLoggingMode, setDataLoggingMode] = useState("Every 10 seconds");
  
  const [exportStartDate, setExportStartDate] = useState<Date>(subDays(new Date(), 7));
  const [exportEndDate, setExportEndDate] = useState<Date>(new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [showExportPopover, setShowExportPopover] = useState(false);
  
  const [powerMeterOpen, setPowerMeterOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);

  const { data: history, isLoading: historyLoading } = useTruckHistory(truck.deviceId);

  const handleExportHistory = async () => {
    setIsExporting(true);
    try {
      const startTime = exportStartDate.toISOString();
      const endTime = exportEndDate.toISOString();
      const response = await fetch(
        `/api/v1/export/trucks/${truck.id}?startTime=${startTime}&endTime=${endTime}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Export failed");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = truck.name.replace(/[^a-zA-Z0-9-_]/g, "_");
      a.download = `${safeName}_${format(exportStartDate, "yyyy-MM-dd")}_to_${format(exportEndDate, "yyyy-MM-dd")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast({ title: "Export complete", description: "Truck history downloaded successfully" });
      setShowExportPopover(false);
    } catch (error) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const historyData = history || [];
  const socData = historyData.map((d: HistoricalDataPoint) => ({ time: formatTime(d.timestamp), value: d.soc }));
  const voltageData = historyData.map((d: HistoricalDataPoint) => ({ time: formatTime(d.timestamp), value: d.voltage }));
  const currentData = historyData.map((d: HistoricalDataPoint) => ({ time: formatTime(d.timestamp), value: d.current }));
  const wattsData = historyData.map((d: HistoricalDataPoint) => ({ time: formatTime(d.timestamp), value: d.watts }));

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[610px] bg-white shadow-[-1px_0px_22px_-6px_rgba(0,0,0,0.17)] overflow-y-auto z-50">
      {/* Header */}
      <div className="px-[68px] border-b border-[#ebeef2] pt-[19.5px] pb-[19.5px] pl-[58px] pr-[58px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-[26px] font-medium text-black leading-6 tracking-tight" data-testid="truck-detail-name">
              {truck.name}
            </h2>
            <div className="flex items-center gap-[2px]">
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
              <Popover open={showExportPopover} onOpenChange={setShowExportPopover}>
              <PopoverTrigger asChild>
                <button 
                  className="h-[27px] px-3 rounded-md flex items-center gap-2 border border-[#ebeef2] bg-white text-sm text-[#4a5565] hover-elevate ml-[6px] mr-[6px]"
                  data-testid="button-export-truck-history"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 bg-white" align="start">
                <div className="space-y-4">
                  <h4 className="font-medium text-sm">Export History</h4>
                  <p className="text-xs text-muted-foreground">Select a date range to export truck measurement data.</p>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Start Date</label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-left font-normal"
                            data-testid="button-export-start-date"
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            {format(exportStartDate, "MMM d, yyyy")}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 bg-white" align="start">
                          <CalendarComponent
                            mode="single"
                            selected={exportStartDate}
                            onSelect={(date) => date && setExportStartDate(date)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-xs font-medium">End Date</label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-left font-normal"
                            data-testid="button-export-end-date"
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            {format(exportEndDate, "MMM d, yyyy")}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 bg-white" align="start">
                          <CalendarComponent
                            mode="single"
                            selected={exportEndDate}
                            onSelect={(date) => date && setExportEndDate(date)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  
                  <Button 
                    className="w-full bg-[#FA4B1E] hover:bg-[#e0431a] text-white" 
                    onClick={handleExportHistory}
                    disabled={isExporting}
                    data-testid="button-confirm-export"
                  >
                    {isExporting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Download CSV
                      </>
                    )}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
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
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <p className="text-base text-[#4a5565]">{truck.model}</p>
          <div className="w-1 h-1 bg-[#4a5565] rounded-full" />
          <p className="text-base text-[#4a5565]">Serial: {truck.serial}</p>
          <div className="w-1 h-1 bg-[#4a5565] rounded-full" />
          <p className="text-base text-[#4a5565]">FW: {truck.fw}</p>
        </div>
      </div>
      {/* Settings Content */}
      <div className="px-[68px] py-8 space-y-6 pl-[58px] pr-[58px]">
        {/* Event Timeline */}
        <div>
          <TruckTimeline truckId={parseInt(truck.id)} />
        </div>

        {/* Power Meter Voltage Source */}
        <Collapsible open={powerMeterOpen} onOpenChange={setPowerMeterOpen}>
          <div className={`py-4 ${!powerMeterOpen ? "border-b border-[#ebeef2]" : ""}`}>
            <CollapsibleTrigger className="flex items-center justify-between w-full" data-testid="toggle-power-meter">
              <p className="text-lg font-medium text-neutral-950">Power Meter Voltage Source</p>
              {powerMeterOpen ? <Minus className="w-5 h-5 text-[#2d2826]" /> : <Plus className="w-5 h-5 text-[#2d2826]" />}
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="pt-4 space-y-4">
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
            
            <div className="pt-4 space-y-4">
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
          </CollapsibleContent>
        </Collapsible>

        {/* Current Metrics */}
        <Collapsible open={metricsOpen} onOpenChange={setMetricsOpen}>
          <div className={`py-4 ${!metricsOpen ? "border-b border-[#ebeef2]" : ""}`}>
            <CollapsibleTrigger className="flex items-center justify-between w-full" data-testid="toggle-metrics">
              <p className="text-lg font-medium text-neutral-950">Current Metrics</p>
              {metricsOpen ? <Minus className="w-5 h-5 text-[#2d2826]" /> : <Plus className="w-5 h-5 text-[#2d2826]" />}
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-white border border-[#EBEEF2] shadow-[0_1px_3px_0_rgba(96,108,128,0.05)] p-4">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <span className="text-sm font-medium text-muted-foreground">State of Charge</span>
                  <Battery className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-3xl font-bold" data-testid="metric-soc">{truck.soc.toFixed(0)}%</div>
              </div>

              <div className="rounded-lg bg-white border border-[#EBEEF2] shadow-[0_1px_3px_0_rgba(96,108,128,0.05)] p-4">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <span className="text-sm font-medium text-muted-foreground">Voltage</span>
                  <Zap className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-3xl font-bold" data-testid="metric-voltage">{truck.v1.toFixed(2)}V</div>
              </div>

              <div className="rounded-lg bg-white border border-[#EBEEF2] shadow-[0_1px_3px_0_rgba(96,108,128,0.05)] p-4">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <span className="text-sm font-medium text-muted-foreground">Current</span>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-3xl font-bold" data-testid="metric-current">{truck.ah.toFixed(1)}Ah</div>
              </div>

              <div className="rounded-lg bg-white border border-[#EBEEF2] shadow-[0_1px_3px_0_rgba(96,108,128,0.05)] p-4">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <span className="text-sm font-medium text-muted-foreground">Power</span>
                  <Thermometer className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-3xl font-bold" data-testid="metric-power">{truck.p.toFixed(1)}kW</div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Historical Data */}
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <div className={`py-4 ${!historyOpen ? "border-b border-[#ebeef2]" : ""}`}>
            <CollapsibleTrigger className="flex items-center justify-between w-full" data-testid="toggle-history">
              <p className="text-lg font-medium text-neutral-950">Historical Data</p>
              {historyOpen ? <Minus className="w-5 h-5 text-[#2d2826]" /> : <Plus className="w-5 h-5 text-[#2d2826]" />}
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="pt-4">
            {historyLoading ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                Loading historical data...
              </div>
            ) : historyData.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No historical data available
              </div>
            ) : (
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
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
