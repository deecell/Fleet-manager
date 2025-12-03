import { LegacyTruckWithDevice } from "@/lib/api";
import { ArrowUpDown, AlertTriangle } from "lucide-react";
import { useState } from "react";

interface FleetTableProps {
  trucks: LegacyTruckWithDevice[];
  selectedTruckId?: string;
  onTruckSelect: (truckId: string) => void;
  alertTruckIds?: string[];
}

type SortField = keyof LegacyTruckWithDevice | null;

function formatDateTime(dateStr?: string): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function FleetTable({ trucks, selectedTruckId, onTruckSelect, alertTruckIds = [] }: FleetTableProps) {
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);

  const handleSort = (field: keyof LegacyTruckWithDevice) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field as SortField);
      setSortDirection("asc");
    }
  };

  const sortedTrucks = [...trucks].sort((a, b) => {
    const aHasAlert = alertTruckIds.includes(a.id);
    const bHasAlert = alertTruckIds.includes(b.id);
    
    if (aHasAlert && !bHasAlert) return -1;
    if (!aHasAlert && bHasAlert) return 1;
    
    if (!sortField) return 0;
    const aVal = a[sortField];
    const bVal = b[sortField];
    
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDirection === "asc" 
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }
    
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }
    
    return 0;
  });

  return (
    <div className="flex gap-3 w-full mt-[0px] mb-[0px] pt-[2px] pb-[2px] min-w-[900px]">
      {/* Section 1: Truck & Location */}
      <div className="bg-white rounded-b-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.09)] overflow-hidden flex-[23] mt-[21px]">
        <table className="w-full">
          <thead>
            <tr className="bg-[#303030] h-[41px]">
              <th className="py-3 text-left pl-[14px] pr-[14px] rounded-tl-lg">
                <button 
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-1.5 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap"
                  data-testid="sort-name"
                >
                  Truck <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
              <th className="px-3 py-3 text-center text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap"></th>
              <th className="px-3 py-3 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">Fuel Savings</th>
              <th className="px-3 py-3 text-left text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">Driver</th>
              <th className="px-3 py-3 text-left text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">Location</th>
              <th className="px-3 py-3 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap pl-[16px] pr-[16px]">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrucks.map((truck, index) => (
              <tr
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
                onMouseEnter={() => setHoveredRowIndex(index)}
                onMouseLeave={() => setHoveredRowIndex(null)}
                className={`cursor-pointer h-[62px] ${
                  hoveredRowIndex === index ? "bg-[#EEF1FB]" : index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"
                } ${selectedTruckId === truck.id ? "bg-[#EEF1FB]" : ""}`}
                data-testid={`truck-row-${truck.id}`}
              >
                <td className="py-3 pl-[18px] pr-[10px]">
                  <div className="flex items-center gap-2.5">
                    <div 
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        truck.status === "in-service" ? "bg-[#00c950]" : "bg-[#ff0900]"
                      }`}
                      data-testid={`status-dot-${truck.id}`}
                    />
                    <span className={`text-[13px] 2xl:text-sm font-medium whitespace-nowrap ${
                      alertTruckIds.includes(truck.id) ? "text-[#f55200]" : "text-black"
                    }`}>{truck.name}</span>
                    {alertTruckIds.includes(truck.id) && (
                      <AlertTriangle className="w-4 h-4 text-[#f55200] shrink-0" data-testid={`alert-icon-${truck.id}`} />
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                    truck.isParked 
                      ? "bg-[#e8f5e9] text-[#2e7d32]" 
                      : "bg-[#fff3e0] text-[#e65100]"
                  }`} data-testid={`parked-status-${truck.id}`}>
                    {truck.isParked ? "Parked" : "Driving"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="text-[13px] 2xl:text-sm text-[#008236] font-medium tabular-nums" data-testid={`fuel-savings-${truck.id}`}>
                    ${(truck.fuelSavings ?? 0).toFixed(2)}
                  </span>
                </td>
                <td className="px-3 py-2 max-w-[120px]">
                  <span className="text-[13px] 2xl:text-sm text-[#4a5565] line-clamp-2">{truck.driver}</span>
                </td>
                <td className="px-3 py-2 max-w-[160px]">
                  <span className="text-[13px] 2xl:text-sm text-[#4a5565] line-clamp-2">{truck.address}</span>
                </td>
                <td className="px-3 py-2 pl-[10px] pr-[18px] max-w-[120px]">
                  <span className="text-[13px] 2xl:text-sm text-[#4a5565] text-right block whitespace-nowrap">{formatDateTime(truck.lastUpdated)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Section 2: Chassis */}
      <div className="bg-white rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.09)] overflow-hidden flex-[4]">
        <table className="w-full">
          <thead>
            <tr className="h-[21px]">
              <th className="bg-[#FFD7C0] text-[10px] font-medium text-[#FA4B1E] uppercase tracking-[0.7px] text-center rounded-t-lg px-2">
                Chassis
              </th>
            </tr>
            <tr className="bg-[#303030] h-[41px]">
              <th className="px-3 py-3 text-center text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">V</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrucks.map((truck, index) => (
              <tr
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
                onMouseEnter={() => setHoveredRowIndex(index)}
                onMouseLeave={() => setHoveredRowIndex(null)}
                className={`cursor-pointer h-[62px] ${
                  hoveredRowIndex === index ? "bg-[#EEF1FB]" : index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"
                } ${selectedTruckId === truck.id ? "bg-[#EEF1FB]" : ""}`}
              >
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] text-center whitespace-nowrap tabular-nums">{truck.v2.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Section 3: Sleeper */}
      <div className="bg-white rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.09)] overflow-hidden flex-[24]">
        <table className="w-full">
          <thead>
            <tr className="h-[21px]">
              <th colSpan={6} className="bg-[#FFD7C0] text-[10px] font-medium text-[#FA4B1E] uppercase tracking-[0.7px] text-center rounded-t-lg">
                Sleeper
              </th>
            </tr>
            <tr className="bg-[#303030] h-[41px]">
              <th className="px-1.5 py-3 text-center">
                <button 
                  onClick={() => handleSort("soc")}
                  className="flex items-center justify-center gap-1 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap mx-auto"
                  data-testid="sort-soc"
                >
                  SoC (%) <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
              <th className="px-1.5 py-3 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap text-center">V</th>
              <th className="px-1.5 py-3 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap text-center">P (kW)</th>
              <th className="px-1.5 py-3 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap text-center">kWh</th>
              <th className="px-1.5 py-3 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap text-center">Ah</th>
              <th className="px-1.5 py-3 text-center">
                <button 
                  onClick={() => handleSort("temp")}
                  className="flex items-center justify-center gap-1 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap mx-auto"
                  data-testid="sort-temp"
                >
                  Temp (°F) <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedTrucks.map((truck, index) => (
              <tr
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
                onMouseEnter={() => setHoveredRowIndex(index)}
                onMouseLeave={() => setHoveredRowIndex(null)}
                className={`cursor-pointer h-[62px] ${
                  hoveredRowIndex === index ? "bg-[#EEF1FB]" : index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"
                } ${selectedTruckId === truck.id ? "bg-[#EEF1FB]" : ""}`}
              >
                <td className="px-1.5 py-3 whitespace-nowrap text-center">
                  <span className={`text-[13px] 2xl:text-sm font-semibold tabular-nums ${
                    truck.soc >= 60 ? "text-[#39c900]" : "text-[#ff0900]"
                  }`}>
                    {truck.soc.toFixed(0)}
                  </span>
                </td>
                <td className="px-1.5 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap tabular-nums text-center">{truck.v1.toFixed(2)}</td>
                <td className="px-1.5 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap tabular-nums text-center">{truck.p.toFixed(2)}</td>
                <td className="px-1.5 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap tabular-nums text-center">{truck.wh.toFixed(2)}</td>
                <td className="px-1.5 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap tabular-nums text-center">{truck.ah.toFixed(2)}</td>
                <td className="px-1.5 py-3 text-[13px] 2xl:text-sm font-medium text-black whitespace-nowrap tabular-nums text-center">{truck.temp.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
