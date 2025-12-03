import { Link, useLocation } from "wouter";
import { Building2, Truck, Cpu, Users, LayoutDashboard, Layers, LogOut, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminSession, useAdminLogout } from "@/lib/admin-api";
import { useEffect } from "react";

interface AdminLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/fleets", label: "Fleets", icon: Layers },
  { href: "/admin/trucks", label: "Trucks", icon: Truck },
  { href: "/admin/devices", label: "Devices", icon: Cpu },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/issues", label: "Issues", icon: AlertCircle },
];

export function AdminLayout({ children }: AdminLayoutProps) {
  const [location, setLocation] = useLocation();
  const { data: session, isLoading } = useAdminSession();
  const logout = useAdminLogout();

  useEffect(() => {
    if (!isLoading && !session?.isAdmin) {
      setLocation("/admin/login");
    }
  }, [session, isLoading, setLocation]);

  const handleLogout = async () => {
    await logout.mutateAsync();
    setLocation("/admin/login");
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session?.isAdmin) {
    return null;
  }

  return (
    <div className="flex h-screen bg-background">
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border bg-[#ffffff]">
          <Link href="/admin">
            <span className="text-lg font-semibold text-foreground cursor-pointer" data-testid="link-admin-home">
              Deecell Admin
            </span>
          </Link>
        </div>
        <nav className="flex-1 p-4 space-y-1 bg-[#ffffff]">
          {navItems.map((item) => {
            const isActive = location === item.href || 
              (item.href !== "/admin" && location.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "admin-nav-item flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer",
                    isActive ? "active" : "text-muted-foreground"
                  )}
                  data-testid={`link-admin-${item.label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border space-y-2 bg-[#ffffff]">
          <Link href="/">
            <div 
              className="admin-nav-item flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground cursor-pointer"
              data-testid="link-fleet-dashboard"
            >
              <LayoutDashboard className="h-4 w-4" />
              Fleet Dashboard
            </div>
          </Link>
          <div 
            className="admin-nav-item flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground cursor-pointer"
            onClick={handleLogout}
            data-testid="button-admin-logout"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
