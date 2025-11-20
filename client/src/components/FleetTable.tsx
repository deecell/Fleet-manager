import { Truck } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <div className="bg-card rounded-md border border-card-border">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[180px]">
                <button 
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-1 font-medium hover-elevate active-elevate-2 px-2 py-1 -mx-2 -my-1 rounded-md"
                  data-testid="sort-name"
                >
                  Name <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>
                <button 
                  onClick={() => handleSort("model")}
                  className="flex items-center gap-1 font-medium hover-elevate active-elevate-2 px-2 py-1 -mx-2 -my-1 rounded-md"
                  data-testid="sort-model"
                >
                  Model <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>Serial</TableHead>
              <TableHead>FW</TableHead>
              <TableHead className="text-right">V1</TableHead>
              <TableHead className="text-right">V2</TableHead>
              <TableHead className="text-right">P (kW)</TableHead>
              <TableHead className="text-right">Wh</TableHead>
              <TableHead className="text-right">Ah</TableHead>
              <TableHead className="text-right">
                <button 
                  onClick={() => handleSort("temp")}
                  className="flex items-center gap-1 font-medium hover-elevate active-elevate-2 px-2 py-1 -mx-2 -my-1 rounded-md ml-auto"
                  data-testid="sort-temp"
                >
                  Temp (°C) <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button 
                  onClick={() => handleSort("soc")}
                  className="flex items-center gap-1 font-medium hover-elevate active-elevate-2 px-2 py-1 -mx-2 -my-1 rounded-md ml-auto"
                  data-testid="sort-soc"
                >
                  SoC (%) <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead className="text-right">Runtime (h)</TableHead>
              <TableHead>PS</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>X</TableHead>
              <TableHead className="text-right">RSSI</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTrucks.map((truck) => (
              <TableRow
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
                className={`cursor-pointer hover-elevate ${
                  selectedTruckId === truck.id ? "bg-accent" : ""
                }`}
                data-testid={`truck-row-${truck.id}`}
              >
                <TableCell className="font-medium">{truck.name}</TableCell>
                <TableCell>{truck.model}</TableCell>
                <TableCell className="text-muted-foreground">{truck.serial}</TableCell>
                <TableCell className="text-muted-foreground">{truck.fw}</TableCell>
                <TableCell className="text-right font-mono">{truck.v1.toFixed(2)}</TableCell>
                <TableCell className="text-right font-mono">{truck.v2.toFixed(2)}</TableCell>
                <TableCell className="text-right font-mono">{truck.p.toFixed(1)}</TableCell>
                <TableCell className="text-right font-mono">{truck.wh.toFixed(0)}</TableCell>
                <TableCell className="text-right font-mono">{truck.ah.toFixed(1)}</TableCell>
                <TableCell className="text-right font-mono">{truck.temp.toFixed(1)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{truck.soc.toFixed(0)}</TableCell>
                <TableCell className="text-right font-mono">{truck.runtime.toFixed(1)}</TableCell>
                <TableCell className="text-muted-foreground">{truck.ps}</TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate" title={truck.address}>
                  {truck.address}
                </TableCell>
                <TableCell className="text-muted-foreground">{truck.x}</TableCell>
                <TableCell className="text-right font-mono">{truck.rssi}</TableCell>
                <TableCell>
                  <Badge
                    variant={truck.status === "in-service" ? "default" : "destructive"}
                    className="whitespace-nowrap"
                    data-testid={`status-badge-${truck.id}`}
                  >
                    <div className={`w-2 h-2 rounded-full mr-1.5 ${
                      truck.status === "in-service" ? "bg-green-500" : "bg-red-500"
                    }`}></div>
                    {truck.status === "in-service" ? "In Service" : "Not in Service"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
