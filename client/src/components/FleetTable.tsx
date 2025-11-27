import { Truck } from "@shared/schema";
import { ArrowUpDown, Globe } from "lucide-react";
import { useState } from "react";

interface FleetTableProps {
  trucks: Truck[];
  selectedTruckId?: string;
  onTruckSelect: (truckId: string) => void;
}

type SortField = keyof Truck | null;

export default function FleetTable({ trucks, selectedTruckId, onTruckSelect }: FleetTableProps) {
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (field: keyof Truck) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortedTrucks = [...trucks].sort((a, b) => {
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
    <div className="flex gap-3 w-full mt-[18px] pt-[11px] pb-[11px]">
      {/* Section 1: Truck & Location */}
      <div className="bg-white rounded-b-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.09)] overflow-hidden flex-[26] mt-[21px]">
        <table className="w-full">
          <thead>
            <tr className="bg-[#303030] h-[41px]">
              <th className="py-3 text-left pl-[14px] pr-[14px]">
                <button 
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-1.5 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap"
                  data-testid="sort-name"
                >
                  Truck <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
              <th className="px-3 pr-6 py-3 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">Location</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrucks.map((truck, index) => (
              <tr
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
                className={`cursor-pointer h-[62px] ${
                  index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"
                } ${selectedTruckId === truck.id ? "bg-blue-50" : ""}`}
                data-testid={`truck-row-${truck.id}`}
              >
                <td className="py-3 pl-[18px] pr-[18px]">
                  <div className="flex items-center gap-2.5">
                    <div 
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        truck.status === "in-service" ? "bg-[#00c950]" : "bg-[#ff0900]"
                      }`}
                      data-testid={`status-dot-${truck.id}`}
                    />
                    <span className="text-[13px] 2xl:text-sm font-medium text-black whitespace-nowrap">{truck.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3 pl-[18px] pr-[18px]">
                  <div className="flex items-center gap-1.5 justify-end">
                    <Globe className="w-4 h-4 text-[#4a5565] shrink-0" />
                    <span className="text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap">{truck.address}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Section 2: Chassis */}
      <div className="bg-white rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.09)] overflow-hidden flex-[6]">
        <table className="w-full">
          <thead>
            <tr className="h-[21px]">
              <th className="bg-[#e2e8f8] text-[10px] font-medium text-[#6a7fbc] uppercase tracking-[0.7px] text-center rounded-t-lg px-2">
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
                className={`cursor-pointer h-[62px] ${
                  index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"
                } ${selectedTruckId === truck.id ? "bg-blue-50" : ""}`}
              >
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] text-center whitespace-nowrap tabular-nums">{truck.v1.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Section 3: Sleeper */}
      <div className="bg-white rounded-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.09)] overflow-hidden flex-[46]">
        <table className="w-full">
          <thead>
            <tr className="h-[21px]">
              <th colSpan={6} className="bg-[#e2e8f8] text-[10px] font-medium text-[#6a7fbc] uppercase tracking-[0.7px] text-center rounded-t-lg">
                Sleeper
              </th>
            </tr>
            <tr className="bg-[#303030] h-[41px]">
              <th className="px-3 pl-6 py-3 text-left">
                <button 
                  onClick={() => handleSort("soc")}
                  className="flex items-center gap-1.5 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap"
                  data-testid="sort-soc"
                >
                  SoC (%) <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
              <th className="px-3 py-3 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap text-center">V</th>
              <th className="px-3 py-3 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap text-center">P (kW)</th>
              <th className="px-3 py-3 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap text-center">Wh</th>
              <th className="px-3 py-3 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap text-center">Ah</th>
              <th className="px-3 pr-6 py-3 text-right">
                <button 
                  onClick={() => handleSort("temp")}
                  className="flex items-center gap-1.5 text-white text-[13px] 2xl:text-sm font-medium ml-auto whitespace-nowrap"
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
                className={`cursor-pointer h-[62px] ${
                  index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"
                } ${selectedTruckId === truck.id ? "bg-blue-50" : ""}`}
              >
                <td className="px-3 py-3 whitespace-nowrap pl-[18px] pr-[18px] text-center">
                  <span className={`text-[13px] 2xl:text-sm font-semibold tabular-nums ${
                    truck.soc >= 60 ? "text-[#39c900]" : "text-[#ff0900]"
                  }`}>
                    {truck.soc.toFixed(0)}
                  </span>
                </td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap tabular-nums text-center">{truck.v2.toFixed(2)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap tabular-nums text-center">{truck.p.toFixed(1)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap tabular-nums text-center">{truck.wh.toFixed(0)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap tabular-nums text-center">{truck.ah.toFixed(1)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm font-medium text-black whitespace-nowrap tabular-nums pr-[18px] text-center">{truck.temp.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Section 4: Model, Serial, FW */}
      <div className="bg-white rounded-b-lg shadow-[0px_1px_3px_0px_rgba(96,108,128,0.09)] overflow-hidden flex-[22] mt-[21px]">
        <table className="w-full">
          <thead>
            <tr className="bg-[#303030] h-[41px]">
              <th className="px-3 pl-6 py-3 text-left">
                <button 
                  onClick={() => handleSort("model")}
                  className="flex items-center gap-1.5 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap"
                  data-testid="sort-model"
                >
                  Model <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
              <th className="px-3 py-3 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">Serial</th>
              <th className="pr-6 pl-3 py-3 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">FW</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrucks.map((truck, index) => (
              <tr
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
                className={`cursor-pointer h-[62px] ${
                  index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"
                } ${selectedTruckId === truck.id ? "bg-blue-50" : ""}`}
              >
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap pl-[14px] pr-[14px]">{truck.model}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] text-right whitespace-nowrap">{truck.serial}</td>
                <td className="py-3 text-[13px] 2xl:text-sm text-[#4a5565] text-right whitespace-nowrap pl-[14px] pr-[14px]">{truck.fw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
