// Single source of truth for the express-session shape used across the
// Deecell server. Both the customer auth (`requireAuth` /
// `tenantMiddleware`) and the admin auth (`platformAdminMiddleware`)
// share the same session — `userId` / `organizationId` are reused, and
// `isPlatformAdmin` is the only bit that distinguishes an admin session
// from a customer one. Keeping this in one file prevents per-route
// `declare module` blocks from drifting out of sync as fields are
// added.

import "express-session";

declare module "express-session" {
  interface SessionData {
    // Customer + admin (set by both auth paths). Used by tenantMiddleware
    // and platformAdminMiddleware to look up the acting user.
    userId?: number;
    organizationId?: number;
    userEmail?: string;
    userName?: string;

    // Admin-only flag. Set to true when the user authenticated at
    // `/admin/login` AND their `users.is_platform_admin = true`.
    // platformAdminMiddleware gates entirely on this — the customer
    // login path never sets it, so a customer session can never
    // accidentally satisfy admin checks.
    isPlatformAdmin?: boolean;

    // Mirrors `userEmail` for legacy admin response shapes that report
    // the operator email separately. Kept distinct so a future change
    // to admin-only telemetry can update it without touching the
    // customer-facing field.
    adminEmail?: string;
  }
}
