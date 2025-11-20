import { Truck } from "@shared/schema";

interface FleetMapProps {
  trucks: Truck[];
  selectedTruckId?: string;
  onTruckSelect: (truckId: string) => void;
}

export default function FleetMap({ trucks, selectedTruckId, onTruckSelect }: FleetMapProps) {
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

  return (
    <div className="bg-card rounded-md border border-card-border p-6">
      <h2 className="text-lg font-semibold mb-4">Fleet Location Map</h2>
      <div className="relative w-full h-96 bg-muted rounded-md overflow-hidden">
        <svg className="absolute inset-0 w-full h-full">
          <image
            href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 600'%3E%3Crect fill='%23f0f0f0' width='1000' height='600'/%3E%3Cpath fill='%23d0d0d0' d='M200,100 L250,120 L280,100 L320,130 L350,110 L400,140 L450,120 L500,150 L550,130 L600,160 L650,140 L700,170 L750,150 L800,180 L850,160 L900,190 L900,500 L850,480 L800,510 L750,490 L700,520 L650,500 L600,530 L550,510 L500,540 L450,520 L400,550 L350,530 L320,560 L280,540 L250,570 L200,550 Z M150,200 L100,220 L80,250 L70,300 L80,350 L100,400 L150,450 L200,480 Z'/%3E%3C/svg%3E"
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid slice"
          />
          
          {trucks.map((truck) => {
            const x = lonToX(truck.longitude);
            const y = latToY(truck.latitude);
            const isSelected = truck.id === selectedTruckId;
            const isInService = truck.status === "in-service";

            return (
              <g
                key={truck.id}
                onClick={() => onTruckSelect(truck.id)}
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
