import { Router, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import bcrypt from "bcrypt";

const router = Router();

declare module "express-session" {
  interface SessionData {
    userId?: number;
    organizationId?: number;
    userEmail?: string;
    userName?: string;
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.userId || !req.session?.organizationId) {
    return res.status(401).json({ 
      error: "Unauthorized", 
      message: "Please login to continue" 
    });
  }
  next();
};

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: "Missing credentials", 
        message: "Email and password are required" 
      });
    }

    const user = await storage.getUserByEmailGlobal(email.toLowerCase().trim());
    
    if (!user) {
      return res.status(401).json({ 
        error: "Invalid credentials", 
        message: "Email or password is incorrect" 
      });
    }

    if (!user.passwordHash) {
      return res.status(401).json({ 
        error: "Account not configured", 
        message: "Please contact your administrator to set up your password" 
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        error: "Account inactive", 
        message: "Your account has been deactivated. Contact your administrator." 
      });
    }

    const organization = await storage.getOrganization(user.organizationId);
    if (!organization || !organization.isActive) {
      return res.status(401).json({ 
        error: "Organization inactive", 
        message: "Your organization is no longer active. Contact support." 
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    
    if (!passwordMatch) {
      return res.status(401).json({ 
        error: "Invalid credentials", 
        message: "Email or password is incorrect" 
      });
    }

    await storage.updateUserLastLogin(user.organizationId, user.id);

    req.session.regenerate((err) => {
      if (err) {
        console.error("Session regeneration error:", err);
        return res.status(500).json({ 
          error: "Server error", 
          message: "An error occurred during login" 
        });
      }
      
      req.session.userId = user.id;
      req.session.organizationId = user.organizationId;
      req.session.userEmail = user.email;
      req.session.userName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("Session save error:", saveErr);
          return res.status(500).json({ 
            error: "Server error", 
            message: "An error occurred during login" 
          });
        }

        return res.json({ 
          success: true, 
          message: "Login successful",
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            organizationId: user.organizationId,
            organizationName: organization.name,
          }
        });
      });
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ 
      error: "Server error", 
      message: "An error occurred during login" 
    });
  }
});

router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Session destroy error:", err);
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.clearCookie("connect.sid");
    res.json({ success: true, message: "Logged out successfully" });
  });
});

router.get("/session", async (req: Request, res: Response) => {
  if (!req.session?.userId || !req.session?.organizationId) {
    return res.json({ 
      authenticated: false 
    });
  }

  const user = await storage.getUser(req.session.organizationId, req.session.userId);
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    return res.json({ 
      authenticated: false 
    });
  }

  const organization = await storage.getOrganization(user.organizationId);
  if (!organization || !organization.isActive) {
    req.session.destroy(() => {});
    return res.json({ 
      authenticated: false 
    });
  }

  return res.json({ 
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: organization.name,
    }
  });
});

export default router;
