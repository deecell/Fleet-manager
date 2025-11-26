import { Truck } from "@shared/schema";
import { ArrowUpDown } from "lucide-react";
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
    <div className="bg-white rounded-lg border border-[#ebeef2] shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)] overflow-hidden">
      <div className="overflow-x-auto 2xl:overflow-x-visible">
        <table className="w-full min-w-[1100px] 2xl:min-w-0">
          <thead>
            <tr className="bg-[#303030] h-[54px]">
              <th className="pl-4 pr-3 py-4 text-left first:rounded-tl-lg">
                <button 
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-1.5 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap"
                  data-testid="sort-name"
                >
                  Truck <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
              <th className="px-3 py-4 text-left">
                <button 
                  onClick={() => handleSort("model")}
                  className="flex items-center gap-1.5 text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap"
                  data-testid="sort-model"
                >
                  Model <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
              <th className="px-3 py-4 text-left text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">Serial</th>
              <th className="px-3 py-4 text-left text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">FW</th>
              <th className="px-3 py-4 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">V1</th>
              <th className="px-3 py-4 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">V2</th>
              <th className="px-3 py-4 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">P (kW)</th>
              <th className="px-3 py-4 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">Wh</th>
              <th className="px-3 py-4 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">Ah</th>
              <th className="px-3 py-4 text-right">
                <button 
                  onClick={() => handleSort("temp")}
                  className="flex items-center gap-1.5 text-white text-[13px] 2xl:text-sm font-medium ml-auto whitespace-nowrap"
                  data-testid="sort-temp"
                >
                  Temp (°C) <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
              <th className="px-3 py-4 text-right">
                <button 
                  onClick={() => handleSort("soc")}
                  className="flex items-center gap-1.5 text-white text-[13px] 2xl:text-sm font-medium ml-auto whitespace-nowrap"
                  data-testid="sort-soc"
                >
                  SoC (%) <ArrowUpDown className="h-3.5 w-3.5 text-[#838383]" />
                </button>
              </th>
              <th className="px-3 py-4 text-right text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">Runtime (h)</th>
              <th className="px-3 py-4 text-left text-white text-[13px] 2xl:text-sm font-medium whitespace-nowrap">PS</th>
              <th className="pl-3 pr-4 py-4 text-left text-white text-[13px] 2xl:text-sm font-medium last:rounded-tr-lg whitespace-nowrap">Location</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrucks.map((truck, index) => (
              <tr
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
                className={`cursor-pointer h-[54px] ${
                  index % 2 === 1 ? "bg-[#F4F7F9]" : "bg-white"
                } ${selectedTruckId === truck.id ? "bg-blue-50" : ""}`}
                data-testid={`truck-row-${truck.id}`}
              >
                <td className="pl-4 pr-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <div 
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        truck.status === "in-service" ? "bg-[#00c950]" : "bg-[#ff0900]"
                      }`}
                      data-testid={`status-dot-${truck.id}`}
                    />
                    <span className="text-[13px] 2xl:text-sm font-medium text-neutral-950 whitespace-nowrap">{truck.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap">{truck.model}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap">{truck.serial}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap">{truck.fw}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] text-right whitespace-nowrap tabular-nums">{truck.v1.toFixed(2)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] text-right whitespace-nowrap tabular-nums">{truck.v2.toFixed(2)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] text-right whitespace-nowrap tabular-nums">{truck.p.toFixed(1)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] text-right whitespace-nowrap tabular-nums">{truck.wh.toFixed(0)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] text-right whitespace-nowrap tabular-nums">{truck.ah.toFixed(1)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm font-medium text-neutral-950 text-right whitespace-nowrap tabular-nums">{truck.temp.toFixed(1)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  <span className={`text-[13px] 2xl:text-sm font-semibold tabular-nums ${
                    truck.soc >= 60 ? "text-[#39c900]" : "text-[#ff0900]"
                  }`}>
                    {truck.soc.toFixed(0)}
                  </span>
                </td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm font-medium text-neutral-950 text-right whitespace-nowrap tabular-nums">{truck.runtime.toFixed(1)}</td>
                <td className="px-3 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap">{truck.ps}</td>
                <td className="pl-3 pr-4 py-3 text-[13px] 2xl:text-sm text-[#4a5565] whitespace-nowrap max-w-[120px] truncate" title={truck.address}>
                  {truck.address}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
