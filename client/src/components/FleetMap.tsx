import { useState } from "react";
import { Truck } from "@shared/schema";
import mapImage from "@assets/map-test_1763683850537.png";

interface FleetMapProps {
  trucks: Truck[];
  selectedTruckId?: string;
  onTruckSelect: (truckId: string) => void;
}

export default function FleetMap({ trucks, selectedTruckId, onTruckSelect }: FleetMapProps) {
  const [hoveredTruckId, setHoveredTruckId] = useState<string | undefined>();
  
  const minLat = 24;
  const maxLat = 50;
  const minLon = -125;
  const maxLon = -65;

  const latToY = (lat: number) => {
    return ((maxLat - lat) / (maxLat - minLat)) * 100;
  };

  const lonToX = (lon: number) => {
    return ((lon - minLon) / (maxLon - minLon)) * 100;
  };

  const hoveredTruck = trucks.find(t => t.id === hoveredTruckId);

  return (
    <div className="bg-card rounded-md border border-card-border p-6">
      <h2 className="text-lg font-semibold mb-4">Fleet Location Map</h2>
      <div className="relative w-full h-96 bg-muted rounded-md overflow-hidden">
        <img 
          src={mapImage} 
          alt="USA Map" 
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scale(1.5)' }}
        />
        <svg className="absolute inset-0 w-full h-full">
          {trucks.map((truck) => {
            const x = lonToX(truck.longitude);
            const y = latToY(truck.latitude);
            const isSelected = truck.id === selectedTruckId;
            const isInService = truck.status === "in-service";

            return (
              <g
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
                onMouseEnter={() => setHoveredTruckId(truck.id)}
                onMouseLeave={() => setHoveredTruckId(undefined)}
                className="cursor-pointer"
                data-testid={`map-marker-${truck.id}`}
              >
                <circle
                  cx={`${x}%`}
                  cy={`${y}%`}
                  r={isSelected ? "12" : "8"}
                  fill={isInService ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)"}
                  stroke="white"
                  strokeWidth={isSelected ? "3" : "2"}
                  opacity="0.9"
                />
                {isSelected && (
                  <circle
                    cx={`${x}%`}
                    cy={`${y}%`}
                    r="16"
                    fill="none"
                    stroke={isInService ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)"}
                    strokeWidth="2"
                    opacity="0.4"
                  />
                )}
              </g>
            );
          })}
        </svg>
        
        {hoveredTruck && (
          <div 
            className="absolute bg-background border border-border rounded-md p-3 shadow-lg pointer-events-none z-10"
            style={{
              left: `${lonToX(hoveredTruck.longitude)}%`,
              top: `${latToY(hoveredTruck.latitude)}%`,
              transform: 'translate(-50%, calc(-100% - 20px))'
            }}
            data-testid={`tooltip-${hoveredTruck.id}`}
          >
            <div className="space-y-1 text-sm min-w-[200px]">
              <div className="font-semibold flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  hoveredTruck.status === "in-service" ? "bg-green-500" : "bg-red-500"
                }`}></div>
                {hoveredTruck.name}
              </div>
              <div className="text-muted-foreground">{hoveredTruck.model}</div>
              <div className="pt-1 border-t border-border space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SoC:</span>
                  <span className="font-medium">{hoveredTruck.soc.toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Temp:</span>
                  <span className="font-medium">{hoveredTruck.temp.toFixed(1)}°C</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location:</span>
                  <span className="font-medium">{hoveredTruck.address}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm rounded-md p-3 border border-border">
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-muted-foreground">In Service</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span className="text-muted-foreground">Not in Service</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
