# Environment Variables Reference

## Overview

Domain Map uses environment variables for configuration. Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser and must be **client-safe** (no secrets).

## Required Variables

### Map Engine (AMap)

```bash
# AMap JavaScript API Key
# Get from: https://lbs.amap.com/
# Scope: Client-side map rendering (read-only)
# Security: Configure domain restrictions in AMap console
NEXT_PUBLIC_AMAP_KEY=your_amap_key_here

# AMap Security Code (防止盗用)
# Get from: AMap console > Application Security Settings
# Purpose: Prevents unauthorized domain usage
NEXT_PUBLIC_AMAP_SECURITY_CODE=your_security_code_here
```

**Security Notes:**
- These keys are visible in browser JavaScript
- Configure domain restrictions in AMap console:
  - Development: `localhost:3000`
  - Production: Your actual domain
- Keys are read-only (cannot modify data)
- Regenerate keys if exposed publicly

## Optional Variables (Phase 2+)

### Database (PostGIS)
```bash
# PostgreSQL connection string
# Format: postgresql://user:password@host:port/database
# Not used in Phase 1 (frontend only)
DATABASE_URL=postgresql://user:password@localhost:5432/domain_map

# Enable SQL query logging (development only)
DATABASE_LOG_QUERIES=false
```

### Authentication (TBD)
```bash
# Authentication provider (decision pending)
# Examples: NextAuth, Auth0, Clerk
AUTH_PROVIDER=nextauth

# Provider-specific credentials (example)
AUTH_SECRET=your_random_secret_here
AUTH_CLIENT_ID=your_client_id
AUTH_CLIENT_SECRET=your_client_secret
```

### API Configuration
```bash
# API base URL (for frontend to call backend)
# Default: Same origin in production
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api

# Rate limiting (requests per minute)
API_RATE_LIMIT=60

# Maximum query results per request
API_MAX_PAGE_SIZE=100
```

### Feature Flags (Phase 3+)
```bash
# Enable experimental features
NEXT_PUBLIC_FEATURE_SAVED_MAPS=false
NEXT_PUBLIC_FEATURE_SEARCH=false
NEXT_PUBLIC_FEATURE_AI_ASSISTANT=false
```

## Development Setup

### 1. Create Local Environment File

```bash
# Copy example file
cp .env.example .env.local

# Edit with your values
nano .env.local
```

### 2. Obtain AMap Credentials

1. Visit [AMap Open Platform](https://lbs.amap.com/)
2. Register/login
3. Create new application → JavaScript API
4. Configure domain restrictions:
   - Development: `localhost:3000`
   - Add more as needed
5. Copy Key and Security Code to `.env.local`

### 3. Verify Configuration

```bash
# Start dev server
npm run dev

# Check browser console
# Should see map loading (if keys correct)
# Or "NEXT_PUBLIC_AMAP_KEY required" warning (if missing)
```

## Production Deployment

### Environment Variable Checklist

- [ ] `NEXT_PUBLIC_AMAP_KEY` - Domain restricted to production URL
- [ ] `NEXT_PUBLIC_AMAP_SECURITY_CODE` - Matches key
- [ ] `DATABASE_URL` - Production PostgreSQL connection
- [ ] `AUTH_SECRET` - Strong random secret (32+ characters)
- [ ] `NODE_ENV=production` - Set automatically by hosting platform

### Security Best Practices

1. **Never commit `.env.local` to git** (already in `.gitignore`)
2. **Use different keys for dev/staging/prod**
3. **Rotate secrets regularly** (every 90 days)
4. **Restrict database access** by IP whitelist
5. **Use managed secrets** on hosting platform (Vercel Env Vars, Railway, etc.)

## Hosting Platform Configuration

### Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Set environment variables
vercel env add NEXT_PUBLIC_AMAP_KEY production
vercel env add NEXT_PUBLIC_AMAP_SECURITY_CODE production
vercel env add DATABASE_URL production

# Deploy
vercel --prod
```

### Railway

```bash
# Add variables in Railway dashboard
# Or via CLI
railway variables set NEXT_PUBLIC_AMAP_KEY=your_key
railway variables set DATABASE_URL=postgresql://...
```

### Docker

```bash
# Pass via docker run
docker run -e NEXT_PUBLIC_AMAP_KEY=your_key \
           -e DATABASE_URL=postgresql://... \
           domain-map:latest

# Or use .env file
docker run --env-file .env.production domain-map:latest
```

## Troubleshooting

### Map Not Loading

**Symptom:** Blank screen or "Loading map..." forever

**Check:**
1. Browser console for error messages
2. Environment variables are set: `console.log(process.env.NEXT_PUBLIC_AMAP_KEY)`
3. Key is active in AMap console
4. Domain is whitelisted in AMap console
5. Security code matches key

**Fix:**
```bash
# Restart dev server after changing .env.local
# Next.js doesn't hot-reload environment variables
npm run dev
```

### Wrong Environment Variables Loaded

**Symptom:** Production getting development values

**Cause:** Multiple `.env*` files with conflicting values

**Precedence (highest to lowest):**
1. `.env.local` (ignored by git, use for secrets)
2. `.env.production` (committed, production defaults)
3. `.env.development` (committed, development defaults)
4. `.env` (committed, shared defaults)

**Fix:**
```bash
# Remove conflicting files
rm .env.production.local  # Usually not needed

# Verify loaded values
npm run dev -- --debug
# Check startup logs for loaded environment
```

### Environment Variables Not Updating

**Symptom:** Changed `.env.local` but app still uses old values

**Cause:** Next.js caches environment variables at build time

**Fix:**
```bash
# For NEXT_PUBLIC_* variables (client-side)
# Must restart dev server
npm run dev

# For server-only variables
# Must rebuild
npm run build
npm run start
```

## Reference

### Next.js Environment Variables
- [Official Docs](https://nextjs.org/docs/basic-features/environment-variables)
- `NEXT_PUBLIC_*` exposed to browser
- Server-only variables without prefix
- `.env.local` for secrets (gitignored)

### Variable Naming Conventions
- `NEXT_PUBLIC_*` - Client-safe, visible in browser
- `*_URL` - Connection strings, endpoints
- `*_SECRET` - Sensitive keys, passwords
- `*_KEY` / `*_ID` - API credentials
- `FEATURE_*` - Feature flags
- `ENABLE_*` - Boolean toggles

---

**Last Updated:** 2026-08-15  
**Phase:** 1 (Frontend only)  
**Next Update:** Phase 2 (Add database and auth variables)
