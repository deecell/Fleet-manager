import { useState } from "react";
import { TruckWithHistory, Notification } from "@shared/schema";
import FleetStats from "@/components/FleetStats";
import FleetTable from "@/components/FleetTable";
import TruckDetail from "@/components/TruckDetail";
import { Notifications } from "@/components/Notifications";
import { AlertBanner } from "@/components/AlertBanner";
import { generateMockTrucks, generateMockNotifications } from "@/lib/mockData";
import { User } from "lucide-react";
import logoSvg from "@assets/logo.svg";
import allIcon from "@assets/all.svg";

const mockTrucks = generateMockTrucks();
const mockNotifications = generateMockNotifications();

type FilterStatus = "all" | "in-service" | "not-in-service";

export default function Dashboard() {
  const [selectedTruckId, setSelectedTruckId] = useState<string | undefined>();
  const [trucks] = useState<TruckWithHistory[]>(mockTrucks);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);

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
    if (filterStatus === "all") return true;
    return truck.status === filterStatus;
  });

  const selectedTruck = trucks.find(t => t.id === selectedTruckId);
  const activeTrucksCount = trucks.filter(t => t.status === "in-service").length;
  const totalTrucks = trucks.length;

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
              <h1 className="text-base font-medium text-neutral-950" data-testid="header-title">Dashboard</h1>
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
            
            <button 
              className="w-[46px] h-[41px] rounded-full flex items-center justify-center hover-elevate active-elevate-2"
              data-testid="button-user-menu"
            >
              <User className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 lg:px-[144px] py-8 space-y-6">
        <AlertBanner 
          title="Energy Waste Detected"
          description="1 machine is consuming power while idle: Packaging Unit"
        />
        
        <FleetStats trucks={trucks} />
        
        <div className="!mt-[74px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-neutral-950">Fleet Overview</h2>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-neutral-950">Active Trucks</span>
                <span>
                  <span className="font-semibold text-[#39c900]">{activeTrucksCount.toString().padStart(2, '0')}</span>
                  <span className="text-neutral-950"> / {totalTrucks.toString().padStart(2, '0')}</span>
                </span>
              </div>
              
              <div className="bg-[#fafbfc] border border-[#ebeef2] rounded-lg p-1 shadow-[0px_1px_3px_0px_rgba(96,108,128,0.05)]">
                <div className="flex items-center">
                  <button
                    onClick={() => setFilterStatus("all")}
                    className={`px-3 py-1 text-sm rounded-md flex items-center gap-2 ${
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
                    className={`px-3 py-1 text-sm rounded-md flex items-center gap-2 ${
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
                    className={`px-3 py-1 text-sm rounded-md flex items-center gap-2 ${
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
