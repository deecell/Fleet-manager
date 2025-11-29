import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLogin, useSession } from "@/lib/auth-api";
import { Loader2, Truck } from "lucide-react";
import logoSvg from "@assets/logo.svg";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: session, isLoading: sessionLoading } = useSession();
  const login = useLogin();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!sessionLoading && session?.authenticated) {
      setLocation("/");
    }
  }, [session, sessionLoading, setLocation]);

  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session?.authenticated) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await login.mutateAsync({ email, password });
      toast({ 
        title: "Welcome back!",
        description: `Signed in as ${result.user?.firstName || result.user?.email}`
      });
      setLocation("/");
    } catch (error: any) {
      toast({ 
        title: "Login failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto">
            <img src={logoSvg} alt="Deecell Logo" className="h-14 w-auto" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">Deecell Fleet Dashboard</CardTitle>
            <CardDescription className="mt-2">
              Sign in to monitor your fleet in real-time
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
                data-testid="input-login-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
                data-testid="input-login-password"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full bg-[#FA4B1E] border-0 border-transparent" 
              disabled={login.isPending}
              data-testid="button-login-submit"
            >
              {login.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <Truck className="h-4 w-4 mr-2" />
                  Sign in
                </>
              )}
            </Button>
          </form>
          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>Need access? Contact your administrator.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
