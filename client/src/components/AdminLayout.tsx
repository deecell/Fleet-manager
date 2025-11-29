import { Link, useLocation } from "wouter";
import { Building2, Truck, Cpu, Users, LayoutDashboard, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

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
];

export function AdminLayout({ children }: AdminLayoutProps) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen bg-background">
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Link href="/admin">
            <span className="text-lg font-semibold text-foreground cursor-pointer" data-testid="link-admin-home">
              Deecell Admin
            </span>
          </Link>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href || 
              (item.href !== "/admin" && location.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary border-l-4 border-primary -ml-1 pl-4"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
        <div className="p-4 border-t border-border">
          <Link href="/">
            <div 
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
              data-testid="link-fleet-dashboard"
            >
              <LayoutDashboard className="h-4 w-4" />
              Fleet Dashboard
            </div>
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
