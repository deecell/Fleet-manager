-- =============================================
-- users.is_platform_admin column (Task #8)
-- =============================================
-- Replaces the shared ADMIN_PASSWORD model with per-admin email/password
-- identity. This migration ONLY adds the boolean flag column on users.
--
-- The deecell-internal organization and the seed Andy (andy@deecell.com)
-- admin user are intentionally NOT inserted here. They are created by the
-- application's startup bootstrap (server/routes.ts →
-- storage.ensureDeecellInternalSetup) the first time the new app image
-- boots. The bootstrap can detect a fresh INSERT and triggers a SendGrid
-- password-setup invitation in the same flow — if we pre-created Andy
-- here the bootstrap would observe an existing row, skip the invite, and
-- Andy would never receive an email.
--
-- Deploy sequence:
--   1. Run this SQL migration (column only, schema-safe).
--   2. Roll the ECS web service to the new app image.
--   3. App boots: ensureDeecellInternalSetup creates the org + Andy and
--      sends his password-setup invitation. Watch CloudWatch for
--      "[admin-bootstrap] Andy seed user invited; email sent=true".
-- If the email never arrives (SendGrid misconfigured), the
-- /forgot-password form on /admin/login is the manual fallback.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run.

-- 1. Schema change
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Verification
SELECT 'users.is_platform_admin added/verified' AS result;

SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name = 'is_platform_admin';

-- After the next app deploy, this query should show Andy as the first
-- platform admin (and any subsequent admins invited via /admin/users):
SELECT u.email,
       u.first_name,
       u.last_name,
       u.is_platform_admin,
       u.is_active,
       (u.password_hash IS NOT NULL) AS has_password,
       o.slug AS org_slug
FROM users u
JOIN organizations o ON o.id = u.organization_id
WHERE u.is_platform_admin = true
ORDER BY u.email;
