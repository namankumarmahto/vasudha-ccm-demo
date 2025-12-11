#!/usr/bin/env bash
set -e
# writes public/js/config.js from environment variables SUPABASE_URL and SUPABASE_ANON_KEY
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "SUPABASE_URL or SUPABASE_ANON_KEY not set. Aborting."
  exit 1
fi
mkdir -p public/js
cat > public/js/config.js <<EOF
// Auto-generated at build time - safe to commit if using anon key
export const SUPABASE_URL = "${SUPABASE_URL}";
export const SUPABASE_ANON_KEY = "${SUPABASE_ANON_KEY}";
EOF
echo "WROTE public/js/config.js"
