import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrgProvider } from "./lib/org-context";
import Dashboard from "@/pages/Dashboard";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import OrganizationsPage from "@/pages/admin/OrganizationsPage";
import FleetsPage from "@/pages/admin/FleetsPage";
import TrucksPage from "@/pages/admin/TrucksPage";
import DevicesPage from "@/pages/admin/DevicesPage";
import UsersPage from "@/pages/admin/UsersPage";
import IssuesPage from "@/pages/admin/IssuesPage";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard}/>
      <Route path="/login" component={Login}/>
      <Route path="/admin/login" component={AdminLogin}/>
      <Route path="/admin" component={AdminDashboard}/>
      <Route path="/admin/organizations" component={OrganizationsPage}/>
      <Route path="/admin/fleets" component={FleetsPage}/>
      <Route path="/admin/trucks" component={TrucksPage}/>
      <Route path="/admin/devices" component={DevicesPage}/>
      <Route path="/admin/users" component={UsersPage}/>
      <Route path="/admin/issues" component={IssuesPage}/>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <OrgProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </OrgProvider>
    </QueryClientProvider>
  );
}

export default App;
