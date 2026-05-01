-- =============================================
-- users.is_platform_admin + Andy seed user (Task #8)
-- =============================================
-- Replaces the shared ADMIN_PASSWORD model with per-admin email/password
-- identity. This migration:
--   1. Adds the boolean flag column on users.
--   2. Bootstraps the deecell-internal organization (slug-unique).
--   3. Seeds Andy (andy@deecell.com) as the first platform admin with
--      password_hash = NULL so no plaintext credential ever lives in
--      the migration.
--
-- Andy's password-setup invitation email is sent by the application's
-- startup bootstrap (server/routes.ts → ensureDeecellInternalSetup):
-- after this migration runs, the next app boot detects that Andy exists
-- with NULL password_hash AND no active invitation token, mints a token
-- via createInvitationToken, and emails him via SendGrid. This pattern
-- is idempotent — once an active token exists, subsequent boots skip
-- re-sending. Watch CloudWatch for
--   "[admin-bootstrap] Andy seed user invited; email sent=true"
-- on the first boot after the new app image rolls. If the email never
-- arrives, /forgot-password on /admin/login is the manual fallback.
--
-- Idempotent in three places:
--   1. ADD COLUMN IF NOT EXISTS for the flag.
--   2. INSERT ... ON CONFLICT (slug) DO NOTHING for the org.
--   3. INSERT ... WHERE NOT EXISTS for Andy.
-- Safe to re-run.

-- 1. Schema change
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. Bootstrap the deecell-internal organization (org backing every admin
-- session). The ON CONFLICT (slug) clause requires organizations.slug to be
-- UNIQUE, which it already is in the schema.
INSERT INTO organizations (name, slug, plan, is_active)
VALUES ('Deecell Internal', 'deecell-internal', 'internal', true)
ON CONFLICT (slug) DO NOTHING;

-- 3. Seed Andy as the first platform admin. password_hash NULL forces
-- him through the password-setup flow (the app bootstrap will email him
-- the invitation token on next boot — see header comment above).
INSERT INTO users (
    organization_id,
    email,
    password_hash,
    name,
    first_name,
    last_name,
    role,
    is_active,
    is_platform_admin
)
SELECT
    o.id,
    'andy@deecell.com',
    NULL,
    'Andy Moeck',
    'Andy',
    'Moeck',
    'admin',
    true,
    true
FROM organizations o
WHERE o.slug = 'deecell-internal'
  AND NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.organization_id = o.id
        AND u.email = 'andy@deecell.com'
  );

-- NOTE: we intentionally do NOT include a "drift repair" UPDATE that
-- re-flags Andy's is_platform_admin if it was cleared. Once an admin has
-- been revoked through the Manage Admins UI (or an operator), that
-- decision should persist across migrations and reboots — re-flagging
-- here would silently undo that revoke. If Andy needs to be re-promoted
-- after a revoke, do it explicitly via the Manage Admins UI or a
-- targeted UPDATE.

-- Verification
SELECT 'users.is_platform_admin added/verified' AS result;

SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name = 'is_platform_admin';

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
