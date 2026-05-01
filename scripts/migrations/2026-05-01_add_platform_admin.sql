-- =============================================
-- users.is_platform_admin + Andy seed user (Task #8)
-- =============================================
-- Replaces the shared ADMIN_PASSWORD model with per-admin email/password
-- identity. Adds a boolean flag on users + bootstraps the deecell-internal
-- organization and the seed Andy (andy@deecell.com) admin user.
--
-- Idempotent in three places:
--   1. ADD COLUMN IF NOT EXISTS for the flag.
--   2. INSERT ... ON CONFLICT (slug) DO NOTHING for the org.
--   3. INSERT ... WHERE NOT EXISTS for Andy.
--
-- Andy's password_hash is left NULL — first login goes through
-- /forgot-password (which works because email + isActive are set), and the
-- standard reset-token flow lets him set the password without ever exposing
-- a plaintext credential in the migration.

-- 1. Schema change
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. Bootstrap the deecell-internal organization (org backing every admin
-- session). The ON CONFLICT (slug) clause requires organizations.slug to be
-- UNIQUE, which it already is in the schema.
INSERT INTO organizations (name, slug, plan, is_active)
VALUES ('Deecell Internal', 'deecell-internal', 'internal', true)
ON CONFLICT (slug) DO NOTHING;

-- 3. Seed Andy as the first platform admin.
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

-- 4. Drift repair: if Andy already existed in deecell-internal but the flag
-- got cleared (e.g. via the Manage Admins revoke flow before he logs in for
-- the first time), re-flag him so we don't lock the entire admin surface.
UPDATE users
SET is_platform_admin = true,
    updated_at = NOW()
WHERE email = 'andy@deecell.com'
  AND organization_id = (SELECT id FROM organizations WHERE slug = 'deecell-internal')
  AND is_platform_admin = false;

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
