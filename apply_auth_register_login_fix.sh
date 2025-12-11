#!/usr/bin/env bash
set -euo pipefail
# Run from project root. This will overwrite public/js/auth.js, public/js/guard.js,
# public/login.html and public/user-register.html (back them up if needed).

mkdir -p public/js public/css

# 1) auth.js — registration inserts profile (approved true), login validates existence
cat > public/js/auth.js <<'JS'
/*
  public/js/auth.js
  - Requires public/js/config.js to export SUPABASE_URL and SUPABASE_ANON_KEY
  - Registration: signUp -> insert profile (approved = true) -> redirect to login
  - Login: signInWithPassword -> verify profile exists -> allow login; otherwise signOut & show message
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* --- UI helpers --- */
function makeToastContainer(){ if(document.getElementById('vasudha-toast')) return; const c=document.createElement('div'); c.id='vasudha-toast'; Object.assign(c.style,{position:'fixed',right:'18px',top:'18px',zIndex:99999,display:'flex',flexDirection:'column',gap:'8px'}); document.body.appendChild(c); }
function toast(msg, type='info', t=4000){ makeToastContainer(); const el=document.createElement('div'); el.textContent=msg; el.style.padding='10px 14px'; el.style.borderRadius='10px'; el.style.boxShadow='0 6px 18px rgba(0,0,0,0.08)'; el.style.background = (type==='danger')? '#e74c3c' : (type==='success')? '#2ecc71' : '#f0fff4'; el.style.color = (type==='danger')? '#fff' : '#07250f'; document.getElementById('vasudha-toast').appendChild(el); setTimeout(()=> el.remove(), t); }
function setBusy(btn, busy=true){ if(!btn) return; btn.disabled = busy; if(busy){ btn.dataset.orig = btn.innerHTML; btn.innerHTML = 'Please wait…'; btn.style.opacity='0.7'; } else { if(btn.dataset.orig) btn.innerHTML = btn.dataset.orig; btn.style.opacity='1'; } }

/* --- Basic validators --- */
function isDisposableEmail(email){
  if(!email) return true;
  const disposable = ['mailinator.com','10minutemail.com','tempmail','.tempmail','guerrillamail','trashmail','sharklasers'];
  const host = email.split('@')[1] || '';
  return disposable.some(d => host.includes(d));
}

/* --- Register handler --- */
export async function handleRegisterForm(e){
  e.preventDefault();
  const form = e.target;
  const first = (form.querySelector('#first')?.value || '').trim();
  const last = (form.querySelector('#last')?.value || '').trim();
  const email = (form.querySelector('#email')?.value || '').trim();
  const password = (form.querySelector('#password1')?.value || '').trim();
  const username = (form.querySelector('#usernameReg')?.value || '').trim();
  const phone = (form.querySelector('#phone')?.value || '').trim();
  const role = (form.querySelector('#accountType')?.value || 'buyer').trim();
  const agree = form.querySelector('#agree')?.checked;
  const btn = form.querySelector('button[type="submit"]');

  if(!first || !email || !password){ toast('Fill required fields (first, email, password).','danger'); return; }
  if(!agree){ toast('You must accept Terms & Conditions to register.','danger'); return; }
  if(isDisposableEmail(email)){ toast('Disposable email addresses are not allowed. Use a permanent email.','danger'); return; }

  setBusy(btn, true);
  try{
    const { data: signupData, error: signupErr } = await supabase.auth.signUp({ email, password });
    if(signupErr){ throw signupErr; }

    const userId = signupData?.user?.id || null;
    const full_name = (first + (last ? ' ' + last : '')).trim();

    if(userId){
      // Insert profile with approved = true so the user can login right away
      const { error: pErr } = await supabase.from('profiles').insert([{
        id: userId,
        full_name,
        username: username || null,
        email,
        phone: phone || null,
        role,
        approved: true
      }]);
      if(pErr){ console.error('profiles insert error', pErr); toast('Registered but profile save failed. Contact admin.','danger'); setBusy(btn,false); return; }
      toast('Registration successful — you can now log in.', 'success', 3000);
      setTimeout(()=> window.location.href = '/login.html', 1400);
    } else {
      // If Supabase requires email confirmation, instruct user
      toast('Registration submitted. Check your email to confirm (if required).', 'info', 7000);
    }
  }catch(err){
    console.error('register error', err);
    toast(err?.message || 'Registration failed', 'danger');
  }finally{
    setBusy(btn, false);
  }
}

/* --- Login handler --- */
export async function handleLoginForm(e){
  e.preventDefault();
  const form = e.target;
  const email = (form.querySelector('#username')?.value || '').trim();
  const password = (form.querySelector('#password')?.value || '').trim();
  const btn = form.querySelector('button[type="submit"]');

  if(!email || !password){ toast('Enter email and password.', 'danger'); return; }
  setBusy(btn, true);
  try{
    // Attempt sign-in
    const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    if(signErr){ throw signErr; }

    // Determine user id
    const session = signData?.data?.session || signData?.session || signData;
    const user = session?.user || null;
    if(!user){ toast('No user session obtained.','danger'); setBusy(btn,false); return; }

    // Check profile exists
    const { data: profile, error: profErr } = await supabase.from('profiles').select('id,role,approved,full_name').eq('id', user.id).single();
    if(profErr || !profile){
      // If no profile found, log out and instruct to register
      await supabase.auth.signOut();
      toast('No registration data found for this account. Please register first.', 'danger', 6000);
      setBusy(btn,false);
      return;
    }

    // Optionally check approved flag (if you want manual approval flow)
    if(profile.approved === false){
      await supabase.auth.signOut();
      toast('Your account is not approved yet. Contact admin.', 'info', 6000);
      setBusy(btn,false);
      return;
    }

    // Login successful: redirect by role
    toast('Login successful. Redirecting...', 'success', 1200);
    setTimeout(()=>{
      const role = profile.role || 'buyer';
      if(role === 'admin') window.location.href = '/admin/index.html';
      else if(role === 'verifier') window.location.href = '/verifier.html';
      else if(role === 'field_user') window.location.href = '/field-user.html';
      else window.location.href = '/buyer.html';
    },900);
  }catch(err){
    console.error('login error', err);
    toast(err?.message || 'Login failed', 'danger');
  }finally{
    setBusy(btn, false);
  }
}

/* Wire forms if present */
function initAuth(){
  makeToastContainer();
  const reg = document.getElementById('registerForm');
  if(reg) reg.addEventListener('submit', handleRegisterForm);
  const login = document.getElementById('loginForm');
  if(login) login.addEventListener('submit', handleLoginForm);
}
document.addEventListener('DOMContentLoaded', initAuth);

// Expose supabase for other modules
window._vasudha = window._vasudha || {};
window._vasudha.supabase = supabase;
JS

# 2) guard.js — quick page guard for protected pages (check session + profile existence)
cat > public/js/guard.js <<'JS'
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
JS

# 3) Update login.html (overwrite) to include auth.js (safe, minimal)
cat > public/login.html <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Login — Vasudha</title>
  <style>
    body{font-family:Georgia,serif;background:#f6fbf6;color:#063014;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .card{width:760px;max-width:96%;background:#fff;border-radius:16px;padding:28px;box-shadow:0 12px 36px rgba(0,0,0,0.06)}
    input{padding:12px 14px;border-radius:12px;border:1px solid #e6efe6;background:#f4faf4;font-size:15px;width:100%;box-sizing:border-box}
    .btn{background:linear-gradient(#2f6b3a,#244f2d);color:#fff;padding:12px 18px;border-radius:12px;border:none;font-weight:700;cursor:pointer}
  </style>
</head>
<body>
  <main class="card" role="main">
    <h2>Sign in</h2>
    <form id="loginForm" autocomplete="on" novalidate>
      <label>Email</label>
      <input id="username" type="email" required />
      <label>Password</label>
      <input id="password" type="password" required />
      <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center">
        <a href="/user-register.html">Create account</a>
        <button type="submit" class="btn">Sign in</button>
      </div>
    </form>
  </main>

  <script type="module" src="/js/auth.js"></script>
</body>
</html>
HTML

# 4) Update user-register.html (overwrite) to include auth.js
cat > public/user-register.html <<'HTML'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Register — Vasudha</title>
<style>
  body{font-family:Georgia,serif;background:#f3f8f3;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;padding:20px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.06);width:920px;max-width:96%}
  input,select{width:100%;padding:10px;border-radius:8px;border:1px solid #e6efe6;background:#f6faf6;box-sizing:border-box}
  .btn{background:#2f6b3a;color:#fff;padding:10px 14px;border-radius:8px;border:none;cursor:pointer}
</style>
</head>
<body>
  <main class="card">
    <h1>Create account</h1>
    <form id="registerForm" autocomplete="on" novalidate>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><label>First name *</label><input id="first" required></div>
        <div><label>Last name</label><input id="last"></div>
        <div><label>Email *</label><input id="email" type="email" required></div>
        <div><label>Username</label><input id="usernameReg"></div>
        <div><label>Password *</label><input id="password1" type="password" required></div>
        <div><label>Phone</label><input id="phone"></div>
        <div style="grid-column:1/-1"><label>Account type</label>
          <select id="accountType"><option value="buyer">Buyer</option><option value="project_owner">Project Owner</option><option value="verifier">Verifier</option><option value="field_user">Field User</option></select>
        </div>
        <div style="grid-column:1/-1">
          <label style="display:flex;align-items:center;gap:8px"><input id="agree" type="checkbox" required> I agree to <a href="/terms.html">Terms & Conditions</a></label>
        </div>
      </div>

      <div style="margin-top:12px;display:flex;gap:8px;justify-content:center">
        <button type="submit" class="btn">Create account</button>
        <a href="/login.html" style="align-self:center">Already have account</a>
      </div>
    </form>
  </main>

  <script type="module" src="/js/auth.js"></script>
</body>
</html>
HTML

# 5) make both files staged & commit
git add public/js/auth.js public/js/guard.js public/login.html public/user-register.html || true
git commit -m "Enforce register->DB before login; add guard and improved auth flow" || echo "Nothing to commit"
git push -u origin HEAD || echo "Push failed; please 'git push' manually"

echo "DONE. Quick checklist:"
echo " - Ensure public/js/config.js contains SUPABASE_URL & SUPABASE_ANON_KEY"
echo " - Ensure profiles table exists in Supabase:
echo 'CREATE TABLE public.profiles ( id uuid references auth.users on delete cascade primary key, full_name text, username text unique, email text, phone text, role text default \"buyer\", approved boolean default true, created_at timestamptz default now());'"

echo " - Protected pages should include: <script type=\"module\" src=\"/js/guard.js\"></script> in their <head> and optionally <body data-role=\"buyer\"> to enforce role"
