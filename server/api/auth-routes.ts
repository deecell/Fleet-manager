import { Router, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { sendPasswordResetEmail, sendPasswordChangedEmail, isEmailConfigured } from "../services/email-service";
import { uploadFile, deleteFile } from "../aws/s3";

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

router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        error: "Missing email", 
        message: "Email is required" 
      });
    }

    if (!isEmailConfigured()) {
      return res.status(503).json({ 
        error: "Email not configured", 
        message: "Password reset is not available at this time" 
      });
    }

    const user = await storage.getUserByEmailGlobal(email.toLowerCase().trim());
    
    if (!user || !user.isActive) {
      return res.json({ 
        success: true, 
        message: "If an account exists with this email, you will receive a password reset link" 
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await storage.createPasswordResetToken({
      userId: user.id,
      token,
      expiresAt,
    });

    await sendPasswordResetEmail(user.email, token, user.firstName || undefined);

    return res.json({ 
      success: true, 
      message: "If an account exists with this email, you will receive a password reset link" 
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ 
      error: "Server error", 
      message: "An error occurred processing your request" 
    });
  }
});

router.get("/reset-password/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({ 
        valid: false, 
        message: "Token is required" 
      });
    }

    const resetToken = await storage.getPasswordResetToken(token);
    
    if (!resetToken) {
      return res.status(400).json({ 
        valid: false, 
        message: "Invalid or expired reset link" 
      });
    }

    if (resetToken.usedAt) {
      return res.status(400).json({ 
        valid: false, 
        message: "This reset link has already been used" 
      });
    }

    if (new Date() > resetToken.expiresAt) {
      return res.status(400).json({ 
        valid: false, 
        message: "This reset link has expired" 
      });
    }

    const user = await storage.getUserById(resetToken.userId);
    if (!user || !user.isActive) {
      return res.status(400).json({ 
        valid: false, 
        message: "Account not found" 
      });
    }

    return res.json({ 
      valid: true,
      email: user.email,
    });
  } catch (error) {
    console.error("Validate reset token error:", error);
    return res.status(500).json({ 
      valid: false, 
      message: "An error occurred validating your reset link" 
    });
  }
});

router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ 
        error: "Missing fields", 
        message: "Token and password are required" 
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ 
        error: "Password too short", 
        message: "Password must be at least 8 characters" 
      });
    }

    const resetToken = await storage.getPasswordResetToken(token);
    
    if (!resetToken) {
      return res.status(400).json({ 
        error: "Invalid token", 
        message: "Invalid or expired reset link" 
      });
    }

    if (resetToken.usedAt) {
      return res.status(400).json({ 
        error: "Token used", 
        message: "This reset link has already been used" 
      });
    }

    if (new Date() > resetToken.expiresAt) {
      return res.status(400).json({ 
        error: "Token expired", 
        message: "This reset link has expired" 
      });
    }

    const user = await storage.getUserById(resetToken.userId);
    if (!user || !user.isActive) {
      return res.status(400).json({ 
        error: "Account not found", 
        message: "Account not found or inactive" 
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await storage.updateUserPassword(user.id, passwordHash);

    await storage.markPasswordResetTokenUsed(token);

    await sendPasswordChangedEmail(user.email, user.firstName || undefined);

    return res.json({ 
      success: true, 
      message: "Your password has been reset successfully" 
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ 
      error: "Server error", 
      message: "An error occurred resetting your password" 
    });
  }
});

// Change password for authenticated users
router.post("/change-password", requireAuth, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.userId!;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        error: "Missing fields", 
        message: "Current password and new password are required" 
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ 
        error: "Password too short", 
        message: "New password must be at least 8 characters" 
      });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ 
        error: "User not found", 
        message: "User account not found" 
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ 
        error: "Account inactive", 
        message: "Your account has been deactivated" 
      });
    }

    if (!user.passwordHash) {
      return res.status(400).json({ 
        error: "No password set", 
        message: "No password set for this account. Contact your administrator." 
      });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ 
        error: "Invalid password", 
        message: "Current password is incorrect" 
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await storage.updateUserPassword(userId, newPasswordHash);

    await sendPasswordChangedEmail(user.email, user.firstName || undefined);

    return res.json({ 
      success: true, 
      message: "Password changed successfully" 
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ 
      error: "Server error", 
      message: "An error occurred changing your password" 
    });
  }
});

// Upload/update profile picture
router.post("/profile-picture", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { imageData, contentType } = req.body;

    if (!imageData || !contentType) {
      return res.status(400).json({
        error: "Missing data",
        message: "Image data and content type are required"
      });
    }

    // Validate content type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({
        error: "Invalid format",
        message: "Only JPEG, PNG, GIF, and WebP images are allowed"
      });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        error: "User not found",
        message: "User account not found"
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        error: "Account inactive",
        message: "Your account has been deactivated"
      });
    }

    // Delete old profile picture if exists
    if (user.profilePictureUrl) {
      try {
        const oldKey = user.profilePictureUrl.split('/').pop();
        if (oldKey) {
          await deleteFile(`profile-pictures/${oldKey}`);
        }
      } catch (e) {
        console.warn("Failed to delete old profile picture:", e);
      }
    }

    // Decode base64 and upload to S3
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    
    // Max 5MB
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({
        error: "File too large",
        message: "Profile picture must be less than 5MB"
      });
    }

    const extension = contentType.split("/")[1];
    const key = `profile-pictures/${userId}-${Date.now()}.${extension}`;
    const url = await uploadFile(key, buffer, contentType);

    await storage.updateUserProfilePicture(userId, url);

    // Update session if we're storing profile picture there
    return res.json({
      success: true,
      profilePictureUrl: url
    });
  } catch (error) {
    console.error("Profile picture upload error:", error);
    return res.status(500).json({
      error: "Server error",
      message: "Failed to upload profile picture"
    });
  }
});

// Delete profile picture
router.delete("/profile-picture", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        error: "User not found",
        message: "User account not found"
      });
    }

    if (user.profilePictureUrl) {
      try {
        const oldKey = user.profilePictureUrl.split('/').pop();
        if (oldKey) {
          await deleteFile(`profile-pictures/${oldKey}`);
        }
      } catch (e) {
        console.warn("Failed to delete profile picture from S3:", e);
      }
    }

    await storage.updateUserProfilePicture(userId, null);

    return res.json({
      success: true,
      message: "Profile picture removed"
    });
  } catch (error) {
    console.error("Profile picture delete error:", error);
    return res.status(500).json({
      error: "Server error",
      message: "Failed to remove profile picture"
    });
  }
});

// Get current user profile
router.get("/profile", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const user = await storage.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({
        error: "User not found",
        message: "User account not found"
      });
    }

    return res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePictureUrl: user.profilePictureUrl,
      role: user.role
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({
      error: "Server error",
      message: "Failed to get profile"
    });
  }
});

export default router;
