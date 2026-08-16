-- Recruitment canonical tables: one company, many office sites; one position, one site.
-- Logo prefers the site / subsidiary career-page icon, then company fallback.

CREATE TABLE IF NOT EXISTS companies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  industries text[] NOT NULL DEFAULT '{}',
  scale text,
  rating numeric(2,1),
  summary text,
  career_url text,
  logo_url text,
  logo_emoji text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (slug <> '' AND name <> ''),
  CHECK (scale IS NULL OR scale IN ('startup', 'unicorn', 'bigtech', 'enterprise')),
  CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5))
);

CREATE TABLE IF NOT EXISTS company_sites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  city text,
  lng double precision,
  lat double precision,
  geom geometry(Point,4326) GENERATED ALWAYS AS (
    CASE WHEN lng IS NOT NULL AND lat IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    END
  ) STORED,
  career_url text,
  logo_url text,
  source_id bigint REFERENCES sources(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (name <> ''),
  CHECK ((lng IS NULL) = (lat IS NULL)),
  CHECK (lng IS NULL OR (lng = lng AND lng BETWEEN -180 AND 180)),
  CHECK (lat IS NULL OR (lat = lat AND lat BETWEEN -90 AND 90))
);
CREATE INDEX IF NOT EXISTS company_sites_company_id_idx ON company_sites(company_id);
CREATE INDEX IF NOT EXISTS company_sites_geom_gist ON company_sites USING gist(geom);

CREATE TABLE IF NOT EXISTS positions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id bigint NOT NULL REFERENCES company_sites(id) ON DELETE RESTRICT,
  external_id text NOT NULL,
  title text NOT NULL,
  department text,
  family text NOT NULL,
  taxonomy jsonb NOT NULL DEFAULT '{}',
  salary_min numeric,
  salary_max numeric,
  education text,
  majors text[] NOT NULL DEFAULT '{}',
  skills text[] NOT NULL DEFAULT '{}',
  description text,
  deadline date,
  apply_source text,
  apply_url text,
  status text NOT NULL DEFAULT 'open',
  source_id bigint REFERENCES sources(id) ON DELETE SET NULL,
  retrieved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (external_id <> '' AND title <> ''),
  CHECK (family IN ('intern', 'campus', 'social')),
  CHECK (jsonb_typeof(taxonomy) = 'object'),
  CHECK (status IN ('open', 'closed', 'paused')),
  CHECK (apply_source IS NULL OR apply_source IN ('official', 'boss', 'shixiseng', 'nowcoder', 'liepin', 'other')),
  UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS positions_company_id_idx ON positions(company_id);
CREATE INDEX IF NOT EXISTS positions_site_id_idx ON positions(site_id);
CREATE INDEX IF NOT EXISTS positions_status_family_idx ON positions(status, family);
CREATE INDEX IF NOT EXISTS positions_title_trgm ON positions USING gin(title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS logo_assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id bigint REFERENCES company_sites(id) ON DELETE CASCADE,
  kind text NOT NULL,
  url text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('site', 'company', 'favicon', 'curated')),
  CHECK (url <> ''),
  CHECK (source <> '')
);
CREATE INDEX IF NOT EXISTS logo_assets_company_id_idx ON logo_assets(company_id);
