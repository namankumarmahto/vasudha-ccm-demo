#!/usr/bin/env bash
set -euo pipefail
BRANCH="feature/supabase-auth-rules"

echo "Switching/creating branch $BRANCH..."
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 && git checkout "$BRANCH" || git checkout -b "$BRANCH"

mkdir -p sql public/js

# 1) SQL: add approved/blocked/terms fields (safe: uses IF NOT EXISTS)
cat > sql/alter_profiles.sql <<'SQL'
-- alter_profiles.sql
-- Adds management fields to profiles so admin can approve/block registrations
alter table if exists public.profiles
  add column if not exists approved boolean default false,
  add column if not exists blocked boolean default false,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz;

-- optional: show current rows (manual inspect in Supabase)
-- select id, username, full_name, approved, blocked, terms_version, terms_accepted_at from public.profiles limit 50;
SQL

echo "Wrote sql/alter_profiles.sql"

# 2) Enhanced auth.js (register -> profile includes approved=false; login checks approved/blocked)
cat > public/js/auth.js <<'JS'
/*
  public/js/auth.js — Updated: enforce approval & blocking rules and T&C
  Expects /js/config.js exporting SUPABASE_URL and SUPABASE_ANON_KEY
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const TERMS_VERSION = 'v1'; // bump when T&C change

/* Simple toast UI */
function ensureToastContainer(){
  if(document.getElementById('vasudha-toast-container')) return;
  const c = document.createElement('div');
  c.id = 'vasudha-toast-container';
  Object.assign(c.style,{position:'fixed', right:'18px', top:'18px', zIndex:99999, display:'flex', flexDirection:'column', gap:'8px'});
  document.body.appendChild(c);
}
function toast(msg, type='info', ms=4500){
  ensureToastContainer();
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style,{
    padding:'10px 14px', borderRadius:'10px', boxShadow:'0 6px 18px rgba(0,0,0,0.12)', fontSize:'14px'
  });
  if(type==='danger'){ el.style.background='#c0392b'; el.style.color='#fff'; }
  else if(type==='success'){ el.style.background='#2ecc71'; el.style.color='#063014'; }
  else { el.style.background='#f0f4ef'; el.style.color='#063014'; }
  document.getElementById('vasudha-toast-container').appendChild(el);
  setTimeout(()=> el.remove(), ms);
}
function setBusy(btn, busy=true){
  if(!btn) return;
  if(busy){ btn.disabled=true; btn.dataset.orig = btn.innerHTML; btn.innerHTML = 'Please wait…'; btn.style.opacity='0.7'; }
  else { btn.disabled=false; if(btn.dataset.orig) btn.innerHTML = btn.dataset.orig; btn.style.opacity='1'; }
}

/* ---------- Register: create auth user + profiles row (approved=false by default) ---------- */
async function handleRegister(e){
  e.preventDefault();
  const f = e.target;
  const first = (f.querySelector('#first')?.value || '').trim();
  const last  = (f.querySelector('#last')?.value || '').trim();
  const email = (f.querySelector('#email')?.value || '').trim();
  const password = (f.querySelector('#password1')?.value || '').trim();
  const phone = (f.querySelector('#phone')?.value || '').trim();
  const username = (f.querySelector('#usernameReg')?.value || '').trim();
  const role = (f.querySelector('#accountType')?.value || 'buyer').trim();
  const terms = f.querySelector('#terms')?.checked === true;
  const btn = f.querySelector('button[type="submit"]');

  if(!terms){
    toast('You must accept the Terms & Conditions to create an account.', 'danger');
    return;
  }
  if(!first || !email || !password){
    toast('Please fill required fields (first name, email, password).', 'danger');
    return;
  }
  setBusy(btn, true);

  try{
    // create auth user
    const { data: signData, error: signErr } = await supabase.auth.signUp({ email, password });
    if(signErr) throw signErr;

    const user = signData?.user;
    const full_name = `${first} ${last}`.trim();

    // Insert profile record and mark approved=false (admin must approve), blocked=false
    // store terms metadata
    if(user && user.id){
      const { error: pErr } = await supabase.from('profiles').insert([{
        id: user.id,
        full_name,
        username: username || null,
        phone: phone || null,
        role,
        approved: false,
        blocked: false,
        terms_version: TERMS_VERSION,
        terms_accepted_at: new Date().toISOString()
      }]);
      if(pErr) {
        console.error('profile insert error', pErr);
        toast('Registered but failed to save profile. Contact admin.', 'danger');
        setBusy(btn, false);
        return;
      }
      // Let user know account must be approved by admin
      toast('Registration received. Your account is pending admin approval — you will be notified by email.', 'info', 9000);
      // redirect to login with note (they cannot login until approved)
      setTimeout(()=> window.location.href = '/login.html?pending=true', 1800);
      return;
    }

    // email-confirmation flow (user may need to confirm email)
    toast('Registration submitted. Please check your email to confirm your account if required.', 'info', 9000);

  }catch(err){
    console.error('register err', err);
    toast(err?.message || 'Registration failed', 'danger', 8000);
  }finally{
    setBusy(btn, false);
  }
}

/* ---------- Login: prevent access if profile.approved=false OR profile.blocked=true ---------- */
async function handleLogin(e){
  e.preventDefault();
  const f = e.target;
  const identifier = (f.querySelector('#username')?.value || '').trim(); // expects email
  const password = (f.querySelector('#password')?.value || '').trim();
  const btn = f.querySelector('button[type="submit"]');

  if(!identifier || !password){
    toast('Please enter email and password.', 'danger');
    return;
  }
  setBusy(btn, true);

  try{
    // sign in
    const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({ email: identifier, password });
    if(signErr) throw signErr;

    // get session & user
    const session = signData?.data?.session || signData?.session || null;
    const user = session?.user;
    if(!user){
      toast('Login succeeded but session is missing.', 'danger');
      setBusy(btn, false);
      return;
    }

    // fetch profile row
    const { data: profile, error: profErr } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if(profErr){
      console.warn('profile fetch err', profErr);
      // If profile missing, disallow login for safety
      toast('No profile found. Contact support.', 'danger');
      // optional: sign out user immediately
      await supabase.auth.signOut();
      setBusy(btn, false);
      return;
    }

    // Enforce rules: blocked -> cannot login; not approved -> cannot login
    if(profile.blocked === true){
      await supabase.auth.signOut();
      toast('Your account has been blocked. Contact support for help.', 'danger', 8000);
      setBusy(btn, false);
      return;
    }
    if(profile.approved !== true){
      await supabase.auth.signOut();
      toast('Your account is pending admin approval. You cannot sign in yet.', 'info', 8000);
      setBusy(btn, false);
      return;
    }

    // Optional: check T&C version if you bump later
    if(profile.terms_version !== TERMS_VERSION){
      toast('Please re-accept the latest Terms & Conditions. Contact support.', 'info', 7000);
      // optionally redirect to an acceptance page
    }

    // ok -> redirect by role
    const role = profile.role || 'buyer';
    toast('Login successful — redirecting…', 'success', 1200);
    setTimeout(()=> {
      if(role==='admin') window.location.href = '/admin/index.html';
      else if(role==='verifier') window.location.href = '/verifier.html';
      else if(role==='field_user') window.location.href = '/field-user.html';
      else window.location.href = '/buyer.html';
    }, 900);

  }catch(err){
    console.error('login err', err);
    toast(err?.message || 'Login failed. Check credentials.', 'danger', 6000);
  }finally{
    setBusy(btn, false);
  }
}

/* ------------- protect helper for admin pages ------------- */
export async function checkSessionProtect(){
  const { data } = await supabase.auth.getSession();
  const s = data?.session || null;
  if(!s){ window.location.href = '/login.html'; return false; }

  // ensure profile is approved
  try{
    const user = s.user;
    const { data: profile } = await supabase.from('profiles').select('approved, blocked').eq('id', user.id).single();
    if(!profile || profile.approved !== true){
      await supabase.auth.signOut();
      window.location.href = '/login.html';
      return false;
    }
    if(profile.blocked === true){
      await supabase.auth.signOut();
      window.location.href = '/login.html';
      return false;
    }
  }catch(err){
    console.warn('session protect fetch profile err', err);
    await supabase.auth.signOut();
    window.location.href = '/login.html';
    return false;
  }

  return true;
}

/* ---------- init forms ---------- */
function initForms(){
  const reg = document.getElementById('registerForm'); if(reg) reg.addEventListener('submit', handleRegister);
  const login = document.getElementById('loginForm'); if(login) login.addEventListener('submit', handleLogin);
  ensureToastContainer();
}
document.addEventListener('DOMContentLoaded', initForms);

// debug export
window._vasudha_supabase = { supabase, handleRegister, handleLogin, checkSessionProtect };
JS

echo "Wrote public/js/auth.js with approval/blocking logic"

# 3) Update registration page: require T&C checkbox & show short terms summary
cat > public/user-register.html <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>User Registration — Vasudha</title>
  <style>
    :root{--accent:#2f6b3a;--muted:#f1f6f1}
    body{font-family: Georgia, serif; background: #f8fbf8; color:#063014; margin:0; padding:24px; display:flex; align-items:center; justify-content:center; min-height:100vh}
    .card{width:920px;max-width:96%;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 28px rgba(3,10,7,0.06)}
    h1{font-size:28px;margin-bottom:8px}
    p.lead{color:#3b5a3f;margin-bottom:12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    label{display:block;font-weight:700;margin-bottom:6px}
    input,select,textarea{width:100%;padding:12px 14px;border-radius:12px;border:1px solid #e6efe6;background:var(--muted);font-size:15px}
    .actions{display:flex;gap:12px;justify-content:center;margin-top:18px}
    .btn{background:linear-gradient(#2f6b3a,#244f2d);color:#fff;padding:12px 28px;border-radius:12px;border:none;font-weight:700;cursor:pointer}
    .btn.ghost{background:transparent;border:2px solid #dcdcdc;color:#333}
    .small{font-size:13px;color:#546a56}
    .muted{color:#6b8b74}
    .terms-box{background:#f7faf7;border:1px solid #e6efe6;padding:12px;border-radius:10px;margin-top:10px;font-size:13px;color:#234}
    .center{grid-column:1/-1;display:flex;gap:12px;align-items:center}
    @media(max-width:880px){ .grid{grid-template-columns:1fr} .center{flex-direction:column} }
  </style>
</head>
<body>
  <main class="card" role="main" aria-labelledby="regTitle">
    <h1 id="regTitle">Create your Vasudha account</h1>
    <p class="lead">Sign up to manage projects, buy credits and participate in MRV workflows.</p>

    <form id="registerForm" autocomplete="on" novalidate>
      <div class="grid">
        <div>
          <label for="first">First Name *</label>
          <input id="first" name="first" type="text" required placeholder="First name">
        </div>

        <div>
          <label for="last">Last Name</label>
          <input id="last" name="last" type="text" placeholder="Last name">
        </div>

        <div>
          <label for="email">Email *</label>
          <input id="email" name="email" type="email" required placeholder="you@example.com">
        </div>

        <div>
          <label for="usernameReg">Username (optional)</label>
          <input id="usernameReg" name="usernameReg" type="text" placeholder="username (for display)">
        </div>

        <div>
          <label for="password1">Password *</label>
          <input id="password1" name="password1" type="password" required placeholder="Choose a strong password">
        </div>

        <div>
          <label for="phone">Phone</label>
          <input id="phone" name="phone" type="tel" placeholder="+91 98765 43210">
        </div>

        <div class="center">
          <div style="flex:1">
            <label for="accountType">Account Type</label>
            <select id="accountType" name="accountType">
              <option value="buyer">Buyer</option>
              <option value="project_owner">Project Owner</option>
              <option value="verifier">Verifier</option>
              <option value="field_user">Field User</option>
              <option value="admin">Admin</option>
            </select>
            <div class="small muted">Choose your role. Admin accounts require manual approval.</div>
          </div>
        </div>

      </div>

      <div style="margin-top:12px">
        <div class="terms-box">
          <strong>Terms & Conditions (summary)</strong>
          <ul>
            <li>By registering you confirm that information provided is accurate.</li>
            <li>Accounts are subject to manual admin approval before the first login.</li>
            <li>Accounts may be blocked for misuse; blocked users cannot login.</li>
            <li>You agree to our data usage and MRV policies.</li>
          </ul>
        </div>

        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-top:8px">
          <input type="checkbox" id="terms" required> I accept the Terms & Conditions
        </label>
      </div>

      <div class="actions">
        <button type="submit" class="btn">Create account</button>
        <a href="/login.html" class="btn ghost" role="button">Already have an account</a>
      </div>

      <p class="small muted" style="text-align:center;margin-top:12px">Note: after registration your account will be pending admin approval and you will not be able to log in until approved.</p>
    </form>
  </main>

  <script type="module" src="/js/auth.js"></script>
</body>
</html>
HTML

echo "Wrote public/user-register.html (T&C required; registers with approved=false)"

# 4) Update login page: show pending param handling and clear message if pending
cat > public/login.html <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Login — Vasudha</title>
  <style>
    body{font-family:Georgia,serif;background:#f6fbf6;color:#063014;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .card{width:760px;max-width:96%;background:#fff;border-radius:16px;padding:28px;box-shadow:0 12px 36px rgba(0,0,0,0.06)}
    h2{font-size:28px;margin:0 0 12px}
    .muted{color:#6b8b74;font-size:14px}
    .alert{padding:10px 12px;border-radius:10px;margin-bottom:12px}
    .alert.info{background:#f0f4ef;color:#063014}
    .alert.danger{background:#fbecec;color:#721c24}
    .input{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
    input{padding:12px 14px;border-radius:12px;border:1px solid #e6efe6;background:#f4faf4;font-size:15px}
    .actions{display:flex;gap:12px;align-items:center}
    .btn{background:linear-gradient(#2f6b3a,#244f2d);color:#fff;padding:12px 18px;border-radius:12px;border:none;font-weight:700;cursor:pointer}
    .links{display:flex;gap:8px;justify-content:flex-end}
    @media(max-width:560px){ .card{padding:18px} }
  </style>
</head>
<body>
  <main class="card" role="main" aria-labelledby="loginTitle">
    <h2 id="loginTitle">Welcome back — sign in</h2>

    <div id="pageMessage" style="display:none" class="alert info"></div>

    <p class="muted">Log in with the email you used to register. Note: newly registered accounts are pending admin approval.</p>

    <form id="loginForm" autocomplete="on" novalidate>
      <div class="input">
        <label for="username">Email</label>
        <input id="username" name="username" type="email" placeholder="you@example.com" required>
      </div>

      <div class="input">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" placeholder="Enter password" required>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div class="links"><a href="/user-register.html" style="text-decoration:none;color:#2f6b3a">Create account</a></div>
        <div><button type="submit" class="btn">Sign in</button></div>
      </div>
    </form>
  </main>

  <script>
    // show message if redirected after register
    const params = new URLSearchParams(window.location.search);
    if(params.get('pending') === 'true'){
      const msg = document.getElementById('pageMessage');
      msg.textContent = 'Your account is pending admin approval. You will not be able to sign in until an admin approves your account.';
      msg.style.display = 'block';
    }
  </script>

  <script type="module" src="/js/auth.js"></script>
</body>
</html>
HTML

echo "Wrote public/login.html (displays pending message when ?pending=true)"

# 5) Stage & commit
git add sql public/js/auth.js public/user-register.html public/login.html || true
git commit -m "Add profile approval/block fields + enforce T&C on register; block login until approved; update auth.js and UIs" || echo "Nothing to commit"
git push -u origin "$BRANCH" || echo "Push failed - run 'git push' manually"

echo "ALL DONE."
echo "Next actions you must take:"
echo "  1) Run the SQL in Supabase SQL Editor or via CLI: sql/alter_profiles.sql"
echo "  2) In Supabase Table Editor you will see new columns; for users already present, manually set approved=true (or run SQL to update)."
echo "  3) Admins: to approve a user, run in SQL editor:"
echo "       update public.profiles set approved = true where id = 'USER_UUID_HERE';"
echo "  4) If inserts to profiles fail in production, check RLS policies on profiles table and add a policy allowing authenticated inserts or use Edge Functions."
echo ""
echo "If you want, paste the output of 'git status' or any errors and I'll fix them."
