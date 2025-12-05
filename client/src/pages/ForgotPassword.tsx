import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Mail, CheckCircle2 } from "lucide-react";
import logoSvg from "@assets/logo.svg";
import { Footer } from "@/components/Footer";
import { apiRequest } from "@/lib/queryClient";

export default function ForgotPassword() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email });
      setIsSubmitted(true);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to send reset email",
        variant: "destructive" 
      });
    } finally {
      setIsLoading(false);
    }
  };

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
                {isSubmitted ? "Check Your Email" : "Reset Password"}
              </CardTitle>
              <CardDescription className="mt-2">
                {isSubmitted 
                  ? "If an account exists with this email, you'll receive a password reset link."
                  : "Enter your email address and we'll send you a link to reset your password."
                }
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isSubmitted ? (
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <div className="text-center space-y-4">
                  <p className="text-sm text-muted-foreground">
                    The reset link will expire in 1 hour. If you don't see the email, check your spam folder.
                  </p>
                  <Link href="/login">
                    <Button variant="outline" className="w-full" data-testid="link-back-to-login">
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Login
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                      autoComplete="email"
                      className="pl-10 focus-visible:ring-0 focus-visible:ring-offset-0"
                      data-testid="input-forgot-email"
                    />
                  </div>
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-[#FA4B1E] border-0 border-transparent" 
                  disabled={isLoading}
                  data-testid="button-forgot-submit"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
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
