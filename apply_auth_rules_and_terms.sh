#!/usr/bin/env bash
set -euo pipefail

BRANCH="fix/auth-rules"
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 && git checkout "$BRANCH" || git checkout -b "$BRANCH"

mkdir -p sql public/js

# 1) Update SQL to include approval & blocked flags
cat > sql/create_profiles.sql <<'SQL'
-- create_profiles.sql (updated)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  username text unique,
  phone text,
  role text,
  approved boolean default false,
  blocked boolean default false,
  created_at timestamptz default now()
);
create unique index if not exists profiles_username_idx on public.profiles(username);
SQL

echo "WROTE: sql/create_profiles.sql"

# 2) Overwrite public/user-register.html with Terms & Conditions & clear T&C consent
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
    .card{width:920px;max-width:96%;background:#fff;border-radius:12px;padding:20px;box-shadow:0 10px 28px rgba(3,10,7,0.06)}
    h1{font-size:24px;margin:0 0 6px}
    p.lead{color:#3b5a3f;margin-bottom:12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    label{display:block;font-weight:700;margin-bottom:6px}
    input,select,textarea{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #e6efe6;background:var(--muted);font-size:14px}
    .actions{display:flex;gap:10px;justify-content:center;margin-top:12px}
    .btn{background:linear-gradient(#2f6b3a,#244f2d);color:#fff;padding:10px 18px;border-radius:10px;border:none;font-weight:700;cursor:pointer}
    .btn.ghost{background:transparent;border:2px solid #dcdcdc;color:#333}
    .muted{color:#6b8b74;font-size:13px}
    .terms{background:#fbfdfb;border:1px solid #e9f2ea;padding:12px;border-radius:10px;margin-top:12px;font-size:14px}
    .warning{color:#8b2419;font-weight:700}
    @media(max-width:880px){ .grid{grid-template-columns:1fr} }
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

        <div>
          <label for="accountType">Account Type</label>
          <select id="accountType" name="accountType">
            <option value="buyer">Buyer</option>
            <option value="project_owner">Project Owner</option>
            <option value="verifier">Verifier</option>
            <option value="field_user">Field User</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div style="grid-column:1 / -1">
          <div class="terms">
            <strong>Terms &amp; Conditions — accounts that will NOT be allowed to login</strong>
            <ol>
              <li class="warning">Email domains on our <em>blacklist</em> (temporary or disposable email providers) — these registrations will be rejected.</li>
              <li class="warning">Usernames containing abusive language, impersonation of staff, or reserved keywords (e.g., "admin", "support", "vasudha") — these registrations will be rejected.</li>
              <li class="warning">If you select <strong>Admin</strong> role — the account will be created but <strong>will not be allowed to login</strong> until manually approved by site administrators.</li>
              <li class="warning">Accounts flagged by automated checks (multiple signups from same IP in short time, or other fraud signals) — these accounts will be marked <code>blocked</code> and prevented from login.</li>
              <li class="warning">If your account is manually marked <code>blocked</code> by administrators, you will be prevented from logging in.</li>
            </ol>
            <p class="muted">By registering you agree that your account may be held for manual review. If your registration is held or rejected we will show the reason and instructions.</p>
          </div>
        </div>
      </div>

      <div style="margin-top:12px">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600">
          <input type="checkbox" id="agree" required> I agree to the <a href="#" style="color:var(--accent)">privacy policy</a> and Terms above.
        </label>
      </div>

      <div class="actions">
        <button type="submit" class="btn">Create account</button>
        <a href="/login.html" class="btn ghost" role="button">Already have an account</a>
      </div>

      <p class="muted" style="text-align:center;margin-top:8px">Accounts require approval for certain roles. Admins require manual approval.</p>
    </form>
  </main>

  <script type="module" src="/js/auth.js"></script>
</body>
</html>
HTML

echo "WROTE: public/user-register.html"

# 3) Overwrite public/js/auth.js to enforce rules on register & to block login when not approved/blocked
cat > public/js/auth.js <<'JS'
/*
  public/js/auth.js — Updated to enforce registration rules and block login for disallowed accounts.
  Expects /js/config.js exporting SUPABASE_URL and SUPABASE_ANON_KEY.
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* UI helpers (toast + busy) */
function makeToastContainer(){ if(document.getElementById('vasudha-toast-container')) return; const c=document.createElement('div'); c.id='vasudha-toast-container'; Object.assign(c.style,{position:'fixed',right:'18px',top:'18px',zIndex:99999,display:'flex',flexDirection:'column',gap:'8px'}); document.body.appendChild(c);}
function toast(msg, type='info', timeout=5000){ makeToastContainer(); const el=document.createElement('div'); el.textContent=msg; el.style.padding='8px 12px'; el.style.borderRadius='8px'; el.style.boxShadow='0 6px 18px rgba(0,0,0,0.08)'; el.style.fontSize='13px'; el.style.color=(type==='danger')?'#fff':'#083'; el.style.background=(type==='danger')?'#c0392b':(type==='success')?'#2ecc71':'#f0f6f0'; document.getElementById('vasudha-toast-container').appendChild(el); setTimeout(()=>el.remove(), timeout);}
function setBusy(btn,b=true){ if(!btn) return; btn.disabled = b; if(b){ btn.dataset.orig=btn.innerHTML; btn.innerHTML='Please wait…'; btn.style.opacity='0.7'; } else { if(btn.dataset.orig) btn.innerHTML=btn.dataset.orig; btn.style.opacity='1'; } }

/* Business rules (client-side prevalidation; server must also enforce) */
const BANNED_DOMAINS = ['mailinator.com','10minutemail.com','tempmail.com','disposablemail.com','yopmail.com'];
const BANNED_USERNAMES = ['admin','support','staff','vasudha','root','sysadmin'];
const RESERVED_ROLES = ['admin']; // roles that require manual approval

function domainFromEmail(email){
  try{ return email.split('@')[1].toLowerCase(); }catch(e){ return ''; }
}
function usernameIsBad(name){
  if(!name) return false;
  const n = name.toLowerCase();
  if(BANNED_USERNAMES.includes(n)) return true;
  // simple profanity check (very small): block if contains suspicious chars/words
  const bad = ['fuck','bitch','shit','asshole','cunt'];
  return bad.some(w=> n.includes(w));
}

/* Register handler */
async function handleRegister(e){
  e.preventDefault();
  const form = e.target;
  const first = (form.querySelector('#first')?.value||'').trim();
  const last  = (form.querySelector('#last')?.value||'').trim();
  const email = (form.querySelector('#email')?.value||'').trim().toLowerCase();
  const password = (form.querySelector('#password1')?.value||'').trim();
  const phone = (form.querySelector('#phone')?.value||'').trim();
  const username = (form.querySelector('#usernameReg')?.value||'').trim();
  const role = (form.querySelector('#accountType')?.value||'buyer').trim();
  const agree = form.querySelector('#agree')?.checked;
  const btn = form.querySelector('button[type="submit"]');

  if(!first || !email || !password){ toast('Please fill required fields (first, email, password).','danger'); return; }
  if(!agree){ toast('You must accept the Terms & Conditions to register.','danger'); return; }

  // rule: banned domain
  const domain = domainFromEmail(email);
  if(BANNED_DOMAINS.includes(domain)){ toast('Disposable email addresses are not allowed. Use a real email.','danger'); return; }

  // rule: bad username
  if(username && usernameIsBad(username)){ toast('Chosen username is not allowed. Pick another.', 'danger'); return; }

  // rule: if role is reserved (admin) — allow registration but mark approved=false explicitly and notify user
  const requiresManualApproval = RESERVED_ROLES.includes(role);

  setBusy(btn, true);
  try{
    const { data: signData, error: signErr } = await supabase.auth.signUp({ email, password });
    if(signErr){ throw signErr; }
    const user = signData?.user;
    const full_name = `${first} ${last}`.trim();

    if(user && user.id){
      // Insert profile with approved=false and blocked=false (admins require manual approval)
      const { error: profileErr } = await supabase.from('profiles').insert([{
        id: user.id,
        full_name,
        username: username || null,
        phone: phone || null,
        role,
        approved: requiresManualApproval ? false : false,
        blocked: false
      }]);
      if(profileErr){ console.error('profile insert err', profileErr); toast('Registered but failed to save profile. Contact admin.','danger'); setBusy(btn,false); return; }

      // Inform user accordingly
      if(requiresManualApproval){
        toast('Registration received. Admin accounts require manual approval — you will be notified when approved.','info',8000);
      } else {
        toast('Registration successful. Please check your email to confirm your account (if required).','success',6000);
      }
      // redirect to login (or show message)
      setTimeout(()=> window.location.href = '/login.html', 1800);
    } else {
      // email confirmation flow: user may be null
      toast('Registration submitted. Check your email to confirm (if required).','info',7000);
    }
  }catch(err){
    console.error('register error', err);
    toast(err?.message || 'Registration failed (see console).','danger',8000);
  }finally{
    setBusy(btn, false);
  }
}

/* Login handler */
async function handleLogin(e){
  e.preventDefault();
  const form = e.target;
  const identifier = (form.querySelector('#username')?.value||'').trim();
  const password = (form.querySelector('#password')?.value||'').trim();
  const btn = form.querySelector('button[type="submit"]');

  if(!identifier || !password){ toast('Please enter email and password.','danger'); return; }

  setBusy(btn, true);
  try{
    // attempt sign-in (we require email login)
    const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({ email: identifier, password });
    if(signErr){ throw signErr; }
    const session = signData?.data?.session || signData?.session || signData;
    const user = session?.user;
    if(!user){ toast('Login succeeded but session missing.', 'danger'); setBusy(btn,false); return; }

    // fetch profile
    const { data: profile, error: profErr } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if(profErr){ console.warn('profile fetch error', profErr); /* allow login but warn */ }

    // if profile exists, enforce blocked/approved
    if(profile){
      if(profile.blocked){
        toast('Your account has been blocked. Contact support.', 'danger', 8000);
        // optionally sign out user to clear session
        try{ await supabase.auth.signOut(); }catch(e){}
        setBusy(btn,false);
        return;
      }
      if(!profile.approved){
        toast('Your account is pending approval. You cannot login until approved.', 'info', 7000);
        try{ await supabase.auth.signOut(); }catch(e){}
        setBusy(btn,false);
        return;
      }
    }

    // redirect by role
    const role = profile?.role || 'buyer';
    toast('Login successful. Redirecting...', 'success', 1200);
    setTimeout(()=> {
      if(role === 'admin') window.location.href = '/admin/index.html';
      else if(role === 'verifier') window.location.href = '/verifier.html';
      else if(role === 'field_user') window.location.href = '/field-user.html';
      else window.location.href = '/buyer.html';
    }, 900);

  }catch(err){
    console.error('login error', err);
    toast(err?.message || 'Login failed. Check credentials.', 'danger');
  }finally{
    setBusy(btn,false);
  }
}

/* Init */
function init(){
  const reg = document.getElementById('registerForm'); if(reg) reg.addEventListener('submit', handleRegister);
  const login = document.getElementById('loginForm'); if(login) login.addEventListener('submit', handleLogin);
  makeToastContainer();
}
document.addEventListener('DOMContentLoaded', init);

window._vasudha_supabase = { supabase };
JS

echo "WROTE: public/js/auth.js"

# 4) Stage & commit & push changes
git add sql public/user-register.html public/js/auth.js || true
git commit -m "Add registration rules, terms & block/approval flags; enforce client-side checks and block login until approved" || echo "Nothing to commit"
git push -u origin HEAD || echo "git push failed - run 'git push' manually"

echo
echo "DONE — updated files:"
echo " - sql/create_profiles.sql"
echo " - public/user-register.html"
echo " - public/js/auth.js"
echo
echo "NEXT STEPS (IMPORTANT):"
echo "1) Apply the SQL in Supabase SQL Editor (open your project -> SQL Editor) and run sql/create_profiles.sql to add approved/blocked columns."
echo "2) For already existing profiles, you may need to ALTER table or migrate manually if columns already present."
echo "3) Admins: to approve an account, update profiles row in Supabase (set approved=true)."
echo "4) For server-side safety: create Row Level Security policies in Supabase to prevent unauthorized changes to approved/blocked fields. I can provide policies if you want."
echo
echo "If git push failed, run: git push origin HEAD"
