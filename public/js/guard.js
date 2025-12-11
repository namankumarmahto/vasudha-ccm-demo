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
