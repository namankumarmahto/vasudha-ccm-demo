#!/usr/bin/env bash
set -euo pipefail
BRANCH="feature/add-auth-guards"
echo "Creating branch $BRANCH..."
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 && git checkout "$BRANCH" || git checkout -b "$BRANCH"

# 1) make guard.js
mkdir -p public/js public/css
cat > public/js/guard.js <<'JS'
/*
  guard.js
  - Protects static pages by checking Supabase session + profiles.approved + role.
  - Uses public/js/config.js for SUPABASE_URL and SUPABASE_ANON_KEY (make sure it exists).
  - Usage: include <script type="module" src="/js/guard.js"></script> in <head>.
  - Set required role for a page by adding data-role="buyer|admin|verifier|field_user" on the <body>.
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
  try {
    const res = await supabase.auth.getSession();
    return res?.data?.session || null;
  } catch (e) {
    console.error('guard:getSession', e);
    return null;
  }
}

async function fetchProfile(userId) {
  try {
    const { data, error } = await supabase.from('profiles').select('approved,role').eq('id', userId).single();
    if (error) {
      console.warn('guard:profile fetch error', error);
      return null;
    }
    return data || null;
  } catch (e) {
    console.error('guard:fetchProfile', e);
    return null;
  }
}

function redirectToLogin(msg) {
  if (msg) {
    try { localStorage.setItem('vasudha_auth_msg', msg); } catch(e){} // show after redirect if you want
  }
  window.location.href = '/login.html';
}

(async function guard() {
  // Only run on pages that include body[data-role] or have been instrumented
  try {
    // Wait a tick so DOM exists
    await new Promise(r => setTimeout(r, 10));
    const body = document.body;
    if (!body) return;

    const requiredRole = body.dataset.role;
    // If page not instrumented (no data-role) we still allow access — only instrument pages you want protected
    if (typeof requiredRole === 'undefined' || requiredRole === '') {
      // Not a protected page
      return;
    }

    // Get session
    const session = await getSession();
    if (!session) {
      // not logged in
      redirectToLogin('Please login to access that page.');
      return;
    }

    const user = session.user;
    if (!user || !user.id) {
      redirectToLogin('Session invalid. Please login.');
      return;
    }

    const profile = await fetchProfile(user.id);
    if (!profile) {
      // profile missing or fetch error — sign out and redirect
      try { await supabase.auth.signOut(); } catch(e){}
      redirectToLogin('Your account is not ready. Contact admin.');
      return;
    }

    // check approved
    if (!profile.approved) {
      try { await supabase.auth.signOut(); } catch(e){}
      redirectToLogin('Account awaiting admin approval.');
      return;
    }

    // check role match (allow if roles equal)
    // allow special case: page role 'buyer' should allow 'buyer' only, etc.
    if (requiredRole && profile.role !== requiredRole) {
      // role mismatch -> redirect to login or a safe page
      alert('You do not have permission to access this page.');
      // Optionally redirect to a landing page:
      window.location.href = '/login.html';
      return;
    }

    // passed all checks -> nothing to do (page will continue rendering)
    // You may expose the profile on window for page scripts:
    window.vasudha_profile = profile;
  } catch (err) {
    console.error('guard error', err);
    // On unexpected errors, redirect to login as safe fallback
    redirectToLogin('Auth check failed. Please sign in again.');
  }
})();
JS

chmod +x public/js/guard.js
echo "Created public/js/guard.js"

# 2) files to protect and their roles (modify as needed)
declare -A FILE_ROLE_MAP=(
  ["public/admin/index.html"]="admin"
  ["public/admin/approvals.html"]="admin"
  ["public/buyer.html"]="buyer"
  ["public/buyer-detail.html"]="buyer"
  ["public/buyer-explorer.html"]="buyer"
  ["public/field-user.html"]="field_user"
  ["public/verifier.html"]="verifier"
  ["public/verification.html"]="verifier"
)

# 3) insert script tag and add data-role attribute (if not present)
SCRIPT_TAG='<script type="module" src="/js/guard.js"></script>'

for file in "${!FILE_ROLE_MAP[@]}"; do
  role="${FILE_ROLE_MAP[$file]}"
  if [ ! -f "$file" ]; then
    echo "WARN: $file not found, skipping..."
    continue
  fi

  # add SCRIPT_TAG before </head> if not already present
  if ! grep -qF "$SCRIPT_TAG" "$file"; then
    # safe perl replace: insert before first </head>
    perl -0777 -pe "s#</head>#${SCRIPT_TAG}\n</head>#i" -i.bak "$file" && rm -f "$file.bak"
    echo "Inserted guard script into $file"
  else
    echo "Script already present in $file"
  fi

  # add data-role attribute to body if not present
  if grep -qE '<body[^>]*data-role=' "$file"; then
    echo "data-role already present in $file"
  else
    # add data-role to the first <body ...> tag
    # handles <body> or <body attr...>
    perl -0777 -pe "s#<body(\\s*[^>]*)>#<body\$1 data-role=\"$role\">#i" -i.bak "$file" && rm -f "$file.bak"
    echo "Added data-role=\"$role\" to <body> in $file"
  fi
done

# 4) stage, commit, push
git add public/js/guard.js
for file in "${!FILE_ROLE_MAP[@]}"; do
  [ -f "$file" ] && git add "$file"
done

git commit -m "Add client auth guard (guard.js) and instrument protected pages for role-based access" || echo "Nothing to commit"
git push -u origin "$BRANCH" || echo "Push failed; run: git push -u origin $BRANCH"

echo "DONE — guard.js added and protected pages instrumented. Please verify the following:"
echo " - public/js/config.js must contain correct SUPABASE_URL and SUPABASE_ANON_KEY"
echo " - profiles table must exist and have 'approved' boolean and 'role' column"
echo " - initial admin must be set (role='admin' and approved=true) in Supabase to approve users"
echo "Test by visiting a protected page in incognito — you should be redirected to /login.html."
