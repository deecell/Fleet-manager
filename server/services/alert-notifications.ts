import { storage } from "../storage";
import { sendAlertEmail, isEmailConfigured } from "./email-service";
import type { Alert, User } from "@shared/schema";

const ALERT_SEVERITY_MAP: Record<string, string> = {
  "low_voltage": "warning",
  "device_offline": "warning",
  "critical_voltage": "critical",
  "high_temperature": "warning",
  "maintenance_due": "info",
  "soc_critical": "critical",
  "soc_low": "warning",
};

export async function sendAlertNotifications(alert: Alert): Promise<number> {
  if (!isEmailConfigured()) {
    console.log("[AlertNotifications] Email not configured, skipping notifications");
    return 0;
  }

  try {
    const users = await storage.listUsers(alert.organizationId);
    
    const adminUsers = users.filter(u => 
      u.isActive && 
      u.email && 
      (u.role === "admin" || u.role === "manager")
    );

    if (adminUsers.length === 0) {
      console.log("[AlertNotifications] No admin/manager users to notify for org", alert.organizationId);
      return 0;
    }

    let truckNumber: string | undefined;
    let deviceName: string | undefined;

    if (alert.truckId) {
      const truck = await storage.getTruck(alert.organizationId, alert.truckId);
      if (truck) {
        truckNumber = truck.truckNumber;
      }
    }

    if (alert.deviceId) {
      const device = await storage.getDevice(alert.organizationId, alert.deviceId);
      if (device) {
        deviceName = device.deviceName || device.serialNumber;
      }
    }

    const severity = ALERT_SEVERITY_MAP[alert.alertType] || "info";
    
    let emailsSent = 0;
    for (const user of adminUsers) {
      if (!user.email) continue;
      try {
        const success = await sendAlertEmail(user.email, {
          type: alert.alertType,
          severity,
          title: alert.title,
          message: alert.message || alert.title,
          truckNumber,
          deviceName,
        });
        
        if (success) {
          emailsSent++;
        }
      } catch (error) {
        console.error(`[AlertNotifications] Failed to send to ${user.email}:`, error);
      }
    }

    console.log(`[AlertNotifications] Sent ${emailsSent}/${adminUsers.length} alert emails for ${alert.alertType}`);
    return emailsSent;
  } catch (error) {
    console.error("[AlertNotifications] Error sending notifications:", error);
    return 0;
  }
}

const CRITICAL_ALERT_TYPES = new Set([
  "low_voltage",
  "critical_voltage",
  "soc_critical",
  "device_offline",
]);

export function shouldNotifyForAlert(alertType: string): boolean {
  return CRITICAL_ALERT_TYPES.has(alertType);
}
