-- Expand OAuth providers and keep nested career / notification prefs.

ALTER TABLE auth_identities DROP CONSTRAINT IF EXISTS auth_identities_provider_check;
ALTER TABLE auth_identities
  ADD CONSTRAINT auth_identities_provider_check
  CHECK (provider IN ('phone', 'email', 'github', 'google', 'x', 'wechat'));

UPDATE users
SET preferences = COALESCE(preferences, '{}'::jsonb)
  || jsonb_build_object(
    'notifications', COALESCE(preferences->'notifications', '{"emailJobs":false,"smsJobs":false,"emailSchools":false,"smsSchools":false}'::jsonb),
    'career', COALESCE(preferences->'career', '{"status":"casually","families":["intern","campus"],"industries":["internet"],"strengths":[]}'::jsonb)
  );
