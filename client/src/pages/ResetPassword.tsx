import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Lock, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";
import logoSvg from "@assets/logo.svg";
import { Footer } from "@/components/Footer";
import { apiRequest } from "@/lib/queryClient";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token");
    
    if (!tokenParam) {
      setIsValidating(false);
      setIsValid(false);
      setErrorMessage("Invalid reset link - no token provided");
      return;
    }

    setToken(tokenParam);
    validateToken(tokenParam);
  }, []);

  const validateToken = async (tokenValue: string) => {
    try {
      const response = await fetch(`/api/auth/reset-password/${tokenValue}`);
      const data = await response.json();
      
      if (data.valid) {
        setIsValid(true);
        setEmail(data.email);
      } else {
        setIsValid(false);
        setErrorMessage(data.message || "Invalid or expired reset link");
      }
    } catch (error) {
      setIsValid(false);
      setErrorMessage("Failed to validate reset link");
    } finally {
      setIsValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({ 
        title: "Passwords don't match", 
        description: "Please make sure your passwords match",
        variant: "destructive" 
      });
      return;
    }

    if (password.length < 8) {
      toast({ 
        title: "Password too short", 
        description: "Password must be at least 8 characters",
        variant: "destructive" 
      });
      return;
    }

    setIsLoading(true);
    
    try {
      await apiRequest("POST", "/api/auth/reset-password", { token, password });
      setIsSuccess(true);
      toast({ 
        title: "Password reset successful", 
        description: "You can now log in with your new password" 
      });
    } catch (error: any) {
      toast({ 
        title: "Reset failed", 
        description: error.message || "Failed to reset password",
        variant: "destructive" 
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">Validating your reset link...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background to-muted">
      <div className="flex-1 flex items-center justify-center p-4 pb-24">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto">
              <img src={logoSvg} alt="Deecell Logo" className="h-14 w-auto" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold">
                {isSuccess ? "Password Reset Complete" : !isValid ? "Invalid Link" : "Create New Password"}
              </CardTitle>
              <CardDescription className="mt-2">
                {isSuccess 
                  ? "Your password has been successfully reset."
                  : !isValid 
                    ? errorMessage
                    : `Enter a new password for ${email}`
                }
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isSuccess ? (
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <div className="text-center">
                  <Link href="/login">
                    <Button className="w-full bg-[#FA4B1E] border-0 border-transparent" data-testid="button-go-to-login">
                      Go to Login
                    </Button>
                  </Link>
                </div>
              </div>
            ) : !isValid ? (
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                  </div>
                </div>
                <div className="text-center space-y-4">
                  <p className="text-sm text-muted-foreground">
                    This password reset link is invalid or has expired. Please request a new one.
                  </p>
                  <div className="space-y-2">
                    <Link href="/forgot-password">
                      <Button className="w-full bg-[#FA4B1E] border-0 border-transparent" data-testid="button-request-new-link">
                        Request New Link
                      </Button>
                    </Link>
                    <Link href="/login">
                      <Button variant="outline" className="w-full" data-testid="link-back-to-login">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Login
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter new password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="pl-10 pr-10 focus-visible:ring-0 focus-visible:ring-offset-0"
                      data-testid="input-new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Must be at least 8 characters
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      required
                      autoComplete="new-password"
                      className="pl-10 focus-visible:ring-0 focus-visible:ring-offset-0"
                      data-testid="input-confirm-password"
                    />
                  </div>
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-[#FA4B1E] border-0 border-transparent" 
                  disabled={isLoading}
                  data-testid="button-reset-submit"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
                <div className="text-center">
                  <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <span className="inline-flex items-center gap-1" data-testid="link-back-to-login">
                      <ArrowLeft className="h-3 w-3" />
                      Back to Login
                    </span>
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      <Footer transparent />
    </div>
  );
}
