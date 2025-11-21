import { useState } from "react";
import { TruckWithHistory } from "@shared/schema";
import FleetStats from "@/components/FleetStats";
import FleetMap from "@/components/FleetMap";
import FleetTable from "@/components/FleetTable";
import TruckDetail from "@/components/TruckDetail";
import { generateMockTrucks } from "@/lib/mockData";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Settings, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

//todo: remove mock functionality
const mockTrucks = generateMockTrucks();

type FilterStatus = "all" | "in-service" | "not-in-service";

export default function Dashboard() {
  const [selectedTruckId, setSelectedTruckId] = useState<string | undefined>();
  const [trucks] = useState<TruckWithHistory[]>(mockTrucks);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  const filteredTrucks = trucks.filter(truck => {
    if (filterStatus === "all") return true;
    return truck.status === filterStatus;
  });

  const selectedTruck = trucks.find(t => t.id === selectedTruckId);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background sticky top-0 z-40">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold" data-testid="header-title">Deecell Power Systems</h1>
              <p className="text-sm text-muted-foreground">Integrated Energy System</p>
            </div>
            
            <div className="flex items-center gap-4">
              <button 
                className="relative hover-elevate active-elevate-2 p-2 rounded-md"
                data-testid="button-notifications"
                onClick={() => console.log('Notifications clicked')}
              >
                <Bell className="h-5 w-5" />
                <Badge 
                  variant="destructive" 
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                >
                  3
                </Badge>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button 
                    className="flex items-center gap-3 hover-elevate active-elevate-2 p-2 rounded-md"
                    data-testid="button-user-menu"
                  >
                    <div className="text-right hidden sm:block">
                      <div className="text-sm font-medium">John Operator</div>
                      <div className="text-xs text-muted-foreground">Fleet Manager</div>
                    </div>
                    <Avatar>
                      <AvatarImage src="" alt="User" />
                      <AvatarFallback className="bg-primary text-primary-foreground">JO</AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => console.log('Settings clicked')}
                    data-testid="menu-settings"
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => console.log('Logout clicked')}
                    data-testid="menu-logout"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Logout</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-6 py-8 space-y-6">
        <FleetStats trucks={trucks} />
        <FleetMap 
          trucks={filteredTrucks} 
          selectedTruckId={selectedTruckId}
          onTruckSelect={setSelectedTruckId}
        />
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Fleet Overview</h2>
            <Tabs value={filterStatus} onValueChange={(value) => setFilterStatus(value as FilterStatus)}>
              <TabsList>
                <TabsTrigger value="all" data-testid="filter-all">All</TabsTrigger>
                <TabsTrigger value="in-service" data-testid="filter-in-service">In Service</TabsTrigger>
                <TabsTrigger value="not-in-service" data-testid="filter-not-in-service">Not in Service</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <FleetTable 
            trucks={filteredTrucks}
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
