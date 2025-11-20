import { useState } from "react";
import { TruckWithHistory } from "@shared/schema";
import FleetStats from "@/components/FleetStats";
import FleetMap from "@/components/FleetMap";
import FleetTable from "@/components/FleetTable";
import TruckDetail from "@/components/TruckDetail";
import { generateMockTrucks } from "@/lib/mockData";

//todo: remove mock functionality
const mockTrucks = generateMockTrucks();

export default function Dashboard() {
  const [selectedTruckId, setSelectedTruckId] = useState<string | undefined>();
  const [trucks] = useState<TruckWithHistory[]>(mockTrucks);

  const selectedTruck = trucks.find(t => t.id === selectedTruckId);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background sticky top-0 z-40">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold" data-testid="header-title">Deecell Fleet Tracking</h1>
              <p className="text-sm text-muted-foreground">Integrated Clean Energy System</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-6">
        <FleetStats trucks={trucks} />
        <FleetMap 
          trucks={trucks} 
          selectedTruckId={selectedTruckId}
          onTruckSelect={setSelectedTruckId}
        />
        <div>
          <h2 className="text-lg font-semibold mb-4">Fleet Overview</h2>
          <FleetTable 
            trucks={trucks}
            selectedTruckId={selectedTruckId}
            onTruckSelect={setSelectedTruckId}
          />
        </div>
      </main>

      {selectedTruck && (
        <TruckDetail 
          truck={selectedTruck} 
          onClose={() => setSelectedTruckId(undefined)}
        />
      )}
    </div>
  );
}
