import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAdminLogin, useAdminSession } from "@/lib/admin-api";
import { Loader2 } from "lucide-react";
import logoSvg from "@assets/logo.svg";

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: session, isLoading: sessionLoading } = useAdminSession();
  const login = useAdminLogin();
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session?.isAdmin) {
    setLocation("/admin");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login.mutateAsync({ username, password });
      toast({ title: "Login successful" });
      setLocation("/admin");
    } catch (error: any) {
      toast({ 
        title: "Login failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img src={logoSvg} alt="Deecell Logo" className="h-12 w-auto" />
          </div>
          <CardTitle className="text-2xl">Admin Login</CardTitle>
          <CardDescription>
            Sign in to access the Deecell Admin Dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                required
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
                data-testid="input-admin-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                required
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
                data-testid="input-admin-password"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full text-white hover:opacity-90" 
              style={{ backgroundColor: "#FA4B1E", borderColor: "#FA4B1E" }}
              disabled={login.isPending}
              data-testid="button-admin-login"
            >
              {login.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
          <div className="mt-6 text-center">
            <a 
              href="/" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-back-to-dashboard"
            >
              Back to Fleet Dashboard
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
