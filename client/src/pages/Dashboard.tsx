import { useState } from "react";
import { TruckWithHistory, Notification } from "@shared/schema";
import FleetStats from "@/components/FleetStats";
import FleetTable from "@/components/FleetTable";
import TruckDetail from "@/components/TruckDetail";
import { Notifications } from "@/components/Notifications";
import { AlertBanner } from "@/components/AlertBanner";
import { generateMockTrucks, generateMockNotifications } from "@/lib/mockData";
import { User, LogOut, ChevronDown, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logoSvg from "@assets/logo.svg";
import allIcon from "@assets/all.svg";

const mockTrucks = generateMockTrucks();
const mockNotifications = generateMockNotifications();

type FilterStatus = "all" | "in-service" | "not-in-service";

export default function Dashboard() {
  const [selectedTruckId, setSelectedTruckId] = useState<string | undefined>();
  const [trucks] = useState<TruckWithHistory[]>(mockTrucks);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  const [dismissedAlertId, setDismissedAlertId] = useState<string | null>(null);

  const handleMarkAsRead = (id: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  const handleMarkAllAsRead = () => {
    setNotifications(prev => 
      prev.map(n => ({ ...n, read: true }))
    );
  };

  const handleDismiss = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const filteredTrucks = trucks.filter(truck => {
    const matchesStatus = filterStatus === "all" || truck.status === filterStatus;
    const matchesSearch = searchQuery === "" || 
      truck.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      truck.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      truck.serial.toLowerCase().includes(searchQuery.toLowerCase()) ||
      truck.address.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const selectedTruck = trucks.find(t => t.id === selectedTruckId);
  const activeTrucksCount = trucks.filter(t => t.status === "in-service").length;
  const totalTrucks = trucks.length;
  
  const latestNotification = notifications
    .filter(n => !n.read && n.id !== dismissedAlertId)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  return (
    <div className="min-h-screen bg-[#fafbfc]">
      <header className="border-b border-gray-200 bg-white h-[75px]">
        <div className="h-full px-6 lg:px-[144px] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img 
              src={logoSvg} 
              alt="Deecell" 
              className="w-[42px] h-[42px]"
              data-testid="header-logo"
            />
            <div>
              <h1 className="text-base font-medium text-neutral-950" data-testid="header-title">Fleet Manager</h1>
              <p className="text-xs text-[#717182]">Deecell Power Systems</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Notifications 
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onDismiss={handleDismiss}
            />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button 
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover-elevate active-elevate-2"
                  data-testid="button-user-menu"
                >
                  <div className="w-8 h-8 rounded-full bg-[#e2e8f8] flex items-center justify-center">
                    <User className="w-4 h-4 text-[#6a7fbc]" />
                  </div>
                  <span className="text-sm font-medium text-neutral-950">John Doe</span>
                  <ChevronDown className="w-4 h-4 text-[#4a5565]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-neutral-950">John Doe</p>
                  <p className="text-xs text-[#4a5565]">john.doe@deecell.com</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="cursor-pointer text-[#ff0900] focus:text-[#ff0900]"
                  data-testid="button-logout"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="px-6 lg:px-[144px] py-8 space-y-6">
        {latestNotification && (
          <AlertBanner 
            title={latestNotification.title}
            description={latestNotification.message}
            truckName={latestNotification.truckName}
            onTruckClick={() => {
              if (latestNotification.truckId) {
                setSelectedTruckId(latestNotification.truckId);
              }
            }}
            onClose={() => setDismissedAlertId(latestNotification.id)}
          />
        )}
        
        <FleetStats trucks={trucks} />
        
        <div className="!mt-[74px]">
          <div className="flex items-center mb-4 gap-4">
            <h2 className="text-[18px] font-semibold text-neutral-950 shrink-0">Fleet Overview</h2>
            
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-950">Active Trucks</span>
              <span>
                <span className="font-semibold text-[#39c900]">{activeTrucksCount.toString().padStart(2, '0')}</span>
                <span className="text-neutral-950"> / {totalTrucks.toString().padStart(2, '0')}</span>
              </span>
            </div>
            
            <div className="relative w-[289px] ml-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[17px] h-[17px] text-[#9c9ca7]" />
              <input
                type="text"
                placeholder="Search for something"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-11 pr-4 bg-white border border-[#ebeef2] rounded-lg text-sm text-neutral-950 placeholder:text-[#9c9ca7] focus:outline-none focus:ring-1 focus:ring-[#ebeef2]"
                data-testid="input-search"
              />
            </div>
            
            <div className="bg-[#fafbfc] border border-[#ebeef2] rounded-lg h-[40px] p-[6px] shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)]">
              <div className="flex items-center h-full">
                <button
                  onClick={() => setFilterStatus("all")}
                  className={`px-2 h-[28px] text-sm rounded-md flex items-center gap-2.5 ${
                    filterStatus === "all" 
                      ? "bg-white border border-[#ebeef2] font-semibold text-neutral-950" 
                      : "text-[#4a5565]"
                  }`}
                  data-testid="filter-all"
                >
                  <img src={allIcon} alt="" className="w-2.5 h-2.5" />
                  All
                </button>
                <button
                  onClick={() => setFilterStatus("in-service")}
                  className={`px-3 h-[28px] text-sm rounded-md flex items-center gap-2 ${
                    filterStatus === "in-service" 
                      ? "bg-white border border-[#ebeef2] font-semibold text-neutral-950" 
                      : "text-[#4a5565]"
                  }`}
                  data-testid="filter-in-service"
                >
                  <div className="w-2 h-2 rounded-full bg-[#39c900]" />
                  In Service
                </button>
                <button
                  onClick={() => setFilterStatus("not-in-service")}
                  className={`px-3 h-[28px] text-sm rounded-md flex items-center gap-2 ${
                    filterStatus === "not-in-service" 
                      ? "bg-white border border-[#ebeef2] font-semibold text-neutral-950" 
                      : "text-[#4a5565]"
                  }`}
                  data-testid="filter-not-in-service"
                >
                  <div className="w-2 h-2 rounded-full bg-[#ff0900]" />
                  Not In Service
                </button>
              </div>
            </div>
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
