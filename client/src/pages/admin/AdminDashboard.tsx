import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminStats } from "@/lib/admin-api";
import { Building2, Truck, Cpu, Users, AlertTriangle, Wifi, WifiOff, Layers } from "lucide-react";

export default function AdminDashboard() {
  const { data, isLoading } = useAdminStats();
  const stats = data?.stats;

  const statCards = [
    { label: "Organizations", value: stats?.totalOrganizations ?? 0, icon: Building2, color: "text-blue-600" },
    { label: "Fleets", value: stats?.totalFleets ?? 0, icon: Layers, color: "text-indigo-600" },
    { label: "Trucks", value: stats?.totalTrucks ?? 0, icon: Truck, color: "text-green-600" },
    { label: "Devices", value: stats?.totalDevices ?? 0, icon: Cpu, color: "text-purple-600" },
    { label: "Users", value: stats?.totalUsers ?? 0, icon: Users, color: "text-orange-600" },
    { label: "Online Devices", value: stats?.onlineDevices ?? 0, icon: Wifi, color: "text-emerald-600" },
    { label: "Offline Devices", value: stats?.offlineDevices ?? 0, icon: WifiOff, color: "text-gray-500" },
    { label: "Active Alerts", value: stats?.activeAlerts ?? 0, icon: AlertTriangle, color: "text-red-600" },
  ];

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground" data-testid="text-admin-title">
            Admin Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            System overview and quick stats
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader className="pb-2">
                  <div className="h-4 bg-muted rounded w-24" />
                </CardHeader>
                <CardContent>
                  <div className="h-8 bg-muted rounded w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {statCards.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label} className="hover-elevate">
                  <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {stat.label}
                    </CardTitle>
                    <Icon className={`h-5 w-5 ${stat.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold" data-testid={`text-stat-${stat.label.toLowerCase().replace(/\s/g, '-')}`}>
                      {stat.value.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <a href="/admin/organizations" className="block p-3 rounded-md border border-border hover:bg-muted transition-colors" data-testid="link-quick-orgs">
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-blue-600" />
                  <div>
                    <div className="font-medium">Manage Organizations</div>
                    <div className="text-sm text-muted-foreground">Create and manage customer accounts</div>
                  </div>
                </div>
              </a>
              <a href="/admin/devices" className="block p-3 rounded-md border border-border hover:bg-muted transition-colors" data-testid="link-quick-devices">
                <div className="flex items-center gap-3">
                  <Cpu className="h-5 w-5 text-purple-600" />
                  <div>
                    <div className="font-medium">Provision Devices</div>
                    <div className="text-sm text-muted-foreground">Register and assign PowerMon devices</div>
                  </div>
                </div>
              </a>
              <a href="/admin/users" className="block p-3 rounded-md border border-border hover:bg-muted transition-colors" data-testid="link-quick-users">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-orange-600" />
                  <div>
                    <div className="font-medium">Manage Users</div>
                    <div className="text-sm text-muted-foreground">Create user accounts and assign roles</div>
                  </div>
                </div>
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">System Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Device Connection Rate</span>
                  <span className="font-medium" data-testid="text-connection-rate">
                    {stats?.totalDevices ? Math.round((stats.onlineDevices / stats.totalDevices) * 100) : 0}%
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all" 
                    style={{ 
                      width: `${stats?.totalDevices ? (stats.onlineDevices / stats.totalDevices) * 100 : 0}%` 
                    }} 
                  />
                </div>
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Active Alerts</span>
                    <span className={`font-medium ${(stats?.activeAlerts ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {stats?.activeAlerts ?? 0}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
