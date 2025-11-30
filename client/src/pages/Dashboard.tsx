import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { LegacyNotification } from "@shared/schema";
import FleetStats from "@/components/FleetStats";
import FleetTable from "@/components/FleetTable";
import TruckDetail from "@/components/TruckDetail";
import { Notifications } from "@/components/Notifications";
import { AlertBanner } from "@/components/AlertBanner";
import { useLegacyTrucks, useLegacyNotifications, useAcknowledgeAlert, useResolveAlert, LegacyTruckWithDevice } from "@/lib/api";
import { useSession, useLogout } from "@/lib/auth-api";
import { useToast } from "@/hooks/use-toast";
import { User, LogOut, ChevronDown, Search, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logoSvg from "@assets/logo.svg";
import allIcon from "@assets/all.svg";

type FilterStatus = "all" | "in-service" | "not-in-service";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: session, isLoading: sessionLoading } = useSession();
  const logout = useLogout();
  
  const [selectedTruckId, setSelectedTruckId] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [alertBannerDismissed, setAlertBannerDismissed] = useState(false);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());
  const [dismissedNotifications, setDismissedNotifications] = useState<Set<string>>(new Set());

  const { data: trucks, isLoading: trucksLoading } = useLegacyTrucks();
  const { data: apiNotifications, isLoading: notificationsLoading } = useLegacyNotifications();
  const acknowledgeAlert = useAcknowledgeAlert();
  const resolveAlert = useResolveAlert();

  useEffect(() => {
    if (!sessionLoading && !session?.authenticated) {
      setLocation("/login");
    }
  }, [session, sessionLoading, setLocation]);

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
      toast({ title: "Logged out successfully" });
      setLocation("/login");
    } catch (error) {
      toast({ 
        title: "Logout failed", 
        variant: "destructive" 
      });
    }
  };

  const handleExportAllTrucks = async () => {
    try {
      const response = await fetch("/api/v1/export/trucks", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Export failed");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fleet_trucks_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast({ title: "Export complete", description: "Fleet data downloaded successfully" });
    } catch (error) {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session?.authenticated) {
    return null;
  }

  const userName = session.user?.firstName 
    ? `${session.user.firstName}${session.user.lastName ? ' ' + session.user.lastName : ''}`
    : session.user?.email || "User";
  const userEmail = session.user?.email || "";
  const organizationName = session.user?.organizationName || "Fleet Dashboard";

  const notifications = (apiNotifications || [])
    .filter(n => !dismissedNotifications.has(n.id))
    .map(n => ({
      ...n,
      read: n.read || readNotifications.has(n.id),
    }));

  const handleMarkAsRead = (id: string) => {
    const alertId = parseInt(id, 10);
    const userId = session?.user?.id;
    if (alertId && userId) {
      acknowledgeAlert.mutate({ alertId, userId });
    }
    setReadNotifications(prev => new Set(prev).add(id));
  };

  const handleMarkAllAsRead = () => {
    const userId = session?.user?.id;
    if (userId) {
      notifications.filter(n => !n.read).forEach(n => {
        const alertId = parseInt(n.id, 10);
        if (alertId) {
          acknowledgeAlert.mutate({ alertId, userId });
        }
      });
    }
    const allIds = notifications.map(n => n.id);
    setReadNotifications(new Set(allIds));
  };

  const handleDismiss = (id: string) => {
    const alertId = parseInt(id, 10);
    if (alertId) {
      resolveAlert.mutate(alertId);
    }
    setDismissedNotifications(prev => new Set(prev).add(id));
  };

  if (trucksLoading || notificationsLoading) {
    return (
      <div className="min-h-screen bg-[#fafbfc] flex flex-col">
        <header className="border-b border-gray-200 bg-white h-[75px]">
          <div className="h-full px-6 lg:px-[144px] flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img src={logoSvg} alt="Deecell" className="w-[42px] h-[42px]" />
              <div>
                <h1 className="text-base font-medium text-neutral-950">Fleet Manager</h1>
                <p className="text-xs text-[#717182]">{organizationName}</p>
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-[#6a7fbc]" />
            <p className="text-sm text-[#4a5565]">Loading fleet data...</p>
          </div>
        </div>
      </div>
    );
  }

  const truckList = trucks || [];
  
  const filteredTrucks = truckList.filter(truck => {
    const matchesStatus = filterStatus === "all" || truck.status === filterStatus;
    const matchesSearch = searchQuery === "" || 
      truck.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      truck.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      truck.serial.toLowerCase().includes(searchQuery.toLowerCase()) ||
      truck.address.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const selectedTruck = truckList.find(t => t.id === selectedTruckId) as LegacyTruckWithDevice | undefined;
  const activeTrucksCount = truckList.filter(t => t.status === "in-service").length;
  const totalTrucks = truckList.length;
  
  const latestNotification = alertBannerDismissed ? undefined : notifications
    .filter(n => !n.read)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  
  const alertTruckIds = notifications
    .filter(n => !n.read && n.truckId)
    .map(n => n.truckId as string);

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
              <p className="text-xs text-[#717182]">{organizationName}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9c9ca7]" />
              <input
                type="text"
                placeholder="Search for something"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 pr-4 bg-[#f5f6f8] border border-[#ebeef2] rounded-lg text-sm text-neutral-950 placeholder:text-[#9c9ca7] focus:outline-none focus:ring-1 focus:ring-[#ebeef2]"
                data-testid="input-search"
              />
            </div>
            
            <Notifications 
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onDismiss={handleDismiss}
            />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button 
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  data-testid="button-user-menu"
                >
                  <div className="w-8 h-8 rounded-full bg-[#e2e8f8] flex items-center justify-center">
                    <User className="w-4 h-4 text-[#6a7fbc]" />
                  </div>
                  <span className="text-sm font-medium text-neutral-950">{userName}</span>
                  <ChevronDown className="w-4 h-4 text-[#4a5565]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-white">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-neutral-950">{userName}</p>
                  <p className="text-xs text-[#4a5565]">{userEmail}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="cursor-pointer text-[#ff0900] focus:text-[#ff0900]"
                  onClick={handleLogout}
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
            onClose={() => setAlertBannerDismissed(true)}
          />
        )}
        
        <FleetStats trucks={truckList} />
        
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
            
            <Button
              variant="outline"
              onClick={handleExportAllTrucks}
              className="ml-auto shrink-0 h-[40px] rounded-lg"
              data-testid="button-export-all-trucks"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            
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
            alertTruckIds={alertTruckIds}
          />
        </div>
      </main>
      {selectedTruck && (
        <TruckDetail 
          truck={selectedTruck} 
          onClose={() => setSelectedTruckId(undefined)}
          alert={notifications.find(n => n.truckId === selectedTruck.id)}
        />
      )}
    </div>
  );
}
