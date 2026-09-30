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
- Next: harden the frontend-to-backend proxy behavior.
