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
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-[#303030] h-[62px]">
              <th className="px-4 py-4 text-left first:rounded-tl-lg">
                <button 
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-1.5 text-white text-sm font-medium"
                  data-testid="sort-name"
                >
                  Name <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </th>
              <th className="px-4 py-4 text-left">
                <button 
                  onClick={() => handleSort("model")}
                  className="flex items-center gap-1.5 text-white text-sm font-medium"
                  data-testid="sort-model"
                >
                  Model <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">Serial</th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">FW</th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">V1</th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">V2</th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">P (kW)</th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">Wh</th>
              <th className="px-4 py-4 text-right text-white text-sm font-medium">Ah</th>
              <th className="px-4 py-4 text-right">
                <button 
                  onClick={() => handleSort("temp")}
                  className="flex items-center gap-1.5 text-white text-sm font-medium ml-auto"
                  data-testid="sort-temp"
                >
                  Temp (°C) <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </th>
              <th className="px-4 py-4 text-right">
                <button 
                  onClick={() => handleSort("soc")}
                  className="flex items-center gap-1.5 text-white text-sm font-medium ml-auto"
                  data-testid="sort-soc"
                >
                  SoC (%) <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">Runtime (h)</th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">PS</th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">Address</th>
              <th className="px-4 py-4 text-left text-white text-sm font-medium">X</th>
              <th className="px-4 py-4 text-right text-white text-sm font-medium last:rounded-tr-lg">RSSI</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrucks.map((truck, index) => (
              <tr
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
                className={`cursor-pointer h-[62px] hover:bg-gray-100 ${
                  index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"
                } ${selectedTruckId === truck.id ? "bg-blue-50" : ""}`}
                data-testid={`truck-row-${truck.id}`}
              >
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div 
                      className={`w-2 h-2 rounded-full ${
                        truck.status === "in-service" ? "bg-[#00c950]" : "bg-[#ff0900]"
                      }`}
                      data-testid={`status-dot-${truck.id}`}
                    />
                    <span className="text-sm font-medium text-neutral-950">{truck.name}</span>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm text-[#4a5565]">{truck.model}</td>
                <td className="px-4 py-4 text-sm text-[#4a5565]">{truck.serial}</td>
                <td className="px-4 py-4 text-sm text-[#4a5565]">{truck.fw}</td>
                <td className="px-4 py-4 text-sm text-[#4a5565] text-right">{truck.v1.toFixed(2)}</td>
                <td className="px-4 py-4 text-sm text-[#4a5565] text-right">{truck.v2.toFixed(2)}</td>
                <td className="px-4 py-4 text-sm text-[#4a5565] text-right">{truck.p.toFixed(1)}</td>
                <td className="px-4 py-4 text-sm text-[#4a5565] text-right">{truck.wh.toFixed(0)}</td>
                <td className="px-4 py-4 text-sm text-[#4a5565] text-right">{truck.ah.toFixed(1)}</td>
                <td className="px-4 py-4 text-sm font-medium text-neutral-950 text-right">{truck.temp.toFixed(1)}</td>
                <td className="px-4 py-4 text-right">
                  <span className={`text-sm font-semibold ${
                    truck.soc >= 60 ? "text-[#39c900]" : "text-[#ff0900]"
                  }`}>
                    {truck.soc.toFixed(0)}
                  </span>
                </td>
                <td className="px-4 py-4 text-sm font-medium text-neutral-950 text-right">{truck.runtime.toFixed(1)}</td>
                <td className="px-4 py-4 text-sm text-[#4a5565]">{truck.ps}</td>
                <td className="px-4 py-4 text-sm text-[#4a5565] max-w-[100px] truncate" title={truck.address}>
                  {truck.address}
                </td>
                <td className="px-4 py-4 text-sm text-[#4a5565]">{truck.x}</td>
                <td className="px-4 py-4 text-sm font-medium text-neutral-950 text-right">{truck.rssi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
