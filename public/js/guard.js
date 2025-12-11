/*
  public/js/guard.js
  Usage: include <script type="module" src="/js/guard.js"></script> in head of protected pages.
  Optionally set <body data-role="buyer"> to enforce role check.
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function protectPage(){
  const { data } = await supabase.auth.getSession();
  const session = data?.session || null;
  if(!session){
    window.location.href = '/login.html';
    return;
  }
  const user = session.user;
  // fetch profile
  const { data: profile, error } = await supabase.from('profiles').select('id,role,approved').eq('id', user.id).single();
  if(error || !profile){
    // no profile -> force logout and redirect to register
    await supabase.auth.signOut();
    alert('No registration found. Please register first.');
    window.location.href = '/user-register.html';
    return;
  }
  // if you want to require approval, uncomment below:
  // if(profile.approved === false){ await supabase.auth.signOut(); alert('Account not approved yet'); window.location.href='/login.html'; return; }

  // role check (optional)
  const requiredRole = document.body?.dataset?.role || null;
  if(requiredRole && profile.role !== requiredRole){
    alert('You do not have permission to view this page.');
    window.location.href = '/login.html';
    return;
  }
}

// run immediately
protectPage();
