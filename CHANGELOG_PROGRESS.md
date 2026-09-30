# AUBI Change Log

This file tracks repository changes made during the production-hardening pass. Each numbered step is committed separately so the Git history stays easy to audit.

## 2026-09-30

### Step 1 — Change tracking initialized
- Added this file to record the hardening work step by step.
- No application behavior changed in this step.

### Step 2 — Improve document metadata and navigation accessibility
- Added richer page metadata, keywords, robots configuration, and dark viewport metadata.
- Added a keyboard-accessible skip link to the main content.
- Added an explicit primary-navigation label and aria-current state for active routes.
- Moved navigation definitions into a reusable constant to keep the component easier to maintain.

### Step 3 — Harden backend proxy and incident streaming
- Added a 15-second timeout to JSON proxy requests so failed backend calls do not hang indefinitely.
- Disabled caching for proxied backend responses and explicitly requested JSON.
- Preserved upstream HTTP status codes for incident SSE responses instead of turning backend errors into successful responses.
- Added validation for the required issue_url stream parameter.
- Added SSE no-transform/no-buffer headers to reduce proxy buffering during live incident runs.
- Added a clear 502 response for backend connectivity failures.

### Step 4 — Add production security headers
- Disabled the default Next.js powered-by response header.
- Added MIME-sniffing protection, clickjacking protection, strict referrer policy, and a restrictive browser permissions policy.
- Added HSTS for HTTPS deployments.
- Next: verify the resulting repository state and check the current deployment wiring without touching unrelated Vercel projects.
