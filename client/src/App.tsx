import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrgProvider } from "./lib/org-context";
import Dashboard from "@/pages/Dashboard";
import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import AcceptInvitation from "@/pages/AcceptInvitation";
import NotFound from "@/pages/not-found";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import OrganizationsPage from "@/pages/admin/OrganizationsPage";
import FleetsPage from "@/pages/admin/FleetsPage";
import TrucksPage from "@/pages/admin/TrucksPage";
import DevicesPage from "@/pages/admin/DevicesPage";
import UsersPage from "@/pages/admin/UsersPage";
import IssuesPage from "@/pages/admin/IssuesPage";
import ExportPage from "@/pages/admin/ExportPage";
import { ExportsBanner } from "@/components/ExportsBanner";
import { ADMIN_EXPORTS_ENDPOINT } from "@/lib/exports-api";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard}/>
      <Route path="/login" component={Login}/>
      <Route path="/forgot-password" component={ForgotPassword}/>
      <Route path="/reset-password" component={ResetPassword}/>
      <Route path="/accept-invitation" component={AcceptInvitation}/>
      <Route path="/admin/login" component={AdminLogin}/>
      <Route path="/admin" component={AdminDashboard}/>
      <Route path="/admin/organizations" component={OrganizationsPage}/>
      <Route path="/admin/fleets" component={FleetsPage}/>
      <Route path="/admin/trucks" component={TrucksPage}/>
      <Route path="/admin/devices" component={DevicesPage}/>
      <Route path="/admin/users" component={UsersPage}/>
      <Route path="/admin/issues" component={IssuesPage}/>
      <Route path="/admin/export" component={ExportPage}/>
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * Mounted once here (not inside AdminLayout) so it survives navigation
 * between admin pages — AdminLayout is re-rendered per admin route, which
 * would otherwise unmount/remount the banner and reset its poll on every
 * click through the sidebar.
 */
function AdminExportsBanner() {
  const [location] = useLocation();
  if (!location.startsWith("/admin") || location === "/admin/login") return null;
  return <ExportsBanner endpoint={ADMIN_EXPORTS_ENDPOINT} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <OrgProvider>
        <TooltipProvider>
          <Toaster />
          <ExportsBanner />
          <AdminExportsBanner />
          <Router />
        </TooltipProvider>
      </OrgProvider>
    </QueryClientProvider>
  );
}

export default App;
