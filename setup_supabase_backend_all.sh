#!/usr/bin/env bash
set -euo pipefail
BRANCH="feature/supabase-backend-auth"
echo "Switching/creating branch $BRANCH"
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 && git checkout "$BRANCH" || git checkout -b "$BRANCH"

# create directories
mkdir -p sql server public/js public/css

# 1) SQL file
cat > sql/create_profiles.sql <<'SQL'
-- create_profiles.sql
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  username text unique,
  phone text,
  role text,
  created_at timestamptz default now()
);
create unique index if not exists profiles_username_idx on public.profiles(username);
SQL

# 2) Server - Express API (server-side user creation using service_role)
cat > server/index.js <<'NODE'
/*
  server/index.js
  Simple Express server exposing POST /api/register
  - Validates registration against Terms & Conditions rules
  - Uses SUPABASE_SERVICE_ROLE (must be set in env) to create user and insert profile
  - Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE
*/
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE){
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE in environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false }});

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));

const limiter = rateLimit({ windowMs: 60*1000, max: 10 });
app.use('/api/', limiter);

/*
  Terms & Conditions rules enforced by server:
  1) Role "admin" cannot self-register (must be approved by existing admin).
  2) Disposable email domains blocked (common disposable domains list).
  3) Username cannot contain offensive words (simple banned words list).
  4) For critical roles (project_owner, field_user) phone is required.
  5) Duplicate username rejected (profiles.username unique).
  6) Password minimum length enforced (8).
*/

const DISPOSABLE_DOMAINS = [
  "mailinator.com","10minutemail.com","guerrillamail.com","tempmail.com","trashmail.com",
  "tempmail.net","dispostable.com","yopmail.com","maildrop.cc"
];

const BANNED_WORDS = ["admin","moderator","root","support","test","null","undefined","fuck","shit","bitch"];

function isDisposableEmail(email){
  try {
    const domain = email.split('@')[1].toLowerCase();
    return DISPOSABLE_DOMAINS.includes(domain);
  } catch(e) { return false; }
}
function containsBannedWord(username){
  if(!username) return false;
  const s = username.toLowerCase();
  return BANNED_WORDS.some(b => s.includes(b));
}

// helper to respond
function fail(res, status, message){
  return res.status(status).json({ ok:false, error: message });
}

app.post('/api/register', async (req, res) => {
  try {
    const { first, last, email, password, phone, username, role } = req.body || {};
    if(!first || !email || !password) return fail(res, 400, 'Missing required fields: first, email, or password.');
    if(password.length < 8) return fail(res, 400, 'Password must be at least 8 characters.');
    const chosenRole = (role || 'buyer').toLowerCase();

    // rule 1: admin cannot self-register
    if(chosenRole === 'admin') return fail(res, 403, 'Registration as admin is not allowed. Contact site administrator.');

    // rule 2: disposable email
    if(isDisposableEmail(email)) return fail(res, 403, 'Disposable email addresses are not allowed. Use a permanent email.');

    // rule 3: banned words in username
    if(username && containsBannedWord(username)) return fail(res, 403, 'Username contains disallowed words. Choose a different username.');

    // rule 4: phone required for specific roles
    if((chosenRole === 'project_owner' || chosenRole === 'field_user') && !phone) {
      return fail(res, 400, 'Phone number is required for the selected role.');
    }

    // rule 5: ensure username unique (if provided)
    if(username) {
      const { data: existing, error: exErr } = await supabase.from('profiles').select('id').eq('username', username).limit(1);
      if(exErr) {
        console.warn('username lookup error', exErr);
        // don't block, continue to try creating user
      } else if(existing && existing.length) {
        return fail(res, 409, 'Username already taken. Choose another.');
      }
    }

    // create user via admin API
    const { data: userData, error: userErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // mark as confirmed to skip email flow if desired; change if you want email verification
      user_metadata: { full_name: (first + ' ' + (last||'')).trim() }
    });

    if(userErr) {
      console.error('supabase admin.createUser error', userErr);
      // If user already exists, supabase returns an error - return a friendly message
      if(userErr?.message?.includes('duplicate key') || userErr?.status === 409) {
        return fail(res, 409, 'User with this email already exists. Login instead or reset password.');
      }
      return fail(res, 500, 'Failed to create user: ' + (userErr.message || 'unknown'));
    }

    const user = userData || null;
    if(!user || !user.id) return fail(res, 500, 'User creation did not return an id.');

    // insert profile row
    const full_name = (first + ' ' + (last||'')).trim();
    const { error: profErr } = await supabase.from('profiles').insert([{
      id: user.id,
      full_name,
      username: username || null,
      phone: phone || null,
      role: chosenRole
    }]);

    if(profErr) {
      console.error('profile insert error', profErr);
      // rollback: delete created user
      try { await supabase.auth.admin.deleteUser(user.id); } catch(e){ console.warn('rollback delete failed', e); }
      return fail(res, 500, 'Failed to save profile. Registration rolled back. Contact admin.');
    }

    return res.json({ ok:true, message: 'Registration successful. You may login now.' });
  } catch(err){
    console.error('register handler error', err);
    return fail(res, 500, 'Internal server error');
  }
});

// health
app.get('/health', (req,res) => res.json({ ok:true }));

const PORT = process.env.PORT || 8787;
app.listen(PORT, ()=> console.log('Server listening on', PORT));
NODE

# 3) Server package.json & env example
cat > server/package.json <<'PKG'
{
  "name": "vasudha-supabase-backend",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.35.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-rate-limit": "^6.7.0"
  }
}
PKG

cat > server/.env.example <<'ENV'
# Copy to .env and fill values
SUPABASE_URL=https://REPLACE_WITH_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE=REPLACE_WITH_SERVICE_ROLE_KEY
CORS_ORIGIN=http://localhost:8000
PORT=8787
ENV

# install server deps
cd server
echo "Installing server dependencies (this may take a minute)..."
npm install --no-audit --no-fund
cd ..

# 4) Public config (frontend public/js/config.js) placeholders (frontend uses anon key)
cat > public/js/config.js <<'CFG'
/*
  public/js/config.js  <- FRONTEND (publishable) config
  Replace placeholders with your Supabase Project URL and ANON key, OR set environment/build script to write this file.
*/
export const SUPABASE_URL = "https://REPLACE_WITH_YOUR_PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "sb-publishable_REPLACE_ME";
CFG

# 5) Frontend auth.js (calls server for registration)
cat > public/js/auth.js <<'JS'
/*
  public/js/auth.js (client)
  - POSTs registration to /api/register (your server)
  - Handles login using Supabase client (anon key)
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function toast(msg, type='info', timeout=4500){
  if(!document.getElementById('vasudha-toast-container')){
    const c = document.createElement('div');
    c.id='vasudha-toast-container';
    Object.assign(c.style,{position:'fixed',right:'18px',top:'18px',zIndex:99999,display:'flex',flexDirection:'column',gap:'10px'});
    document.body.appendChild(c);
  }
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.padding='10px 14px';
  el.style.borderRadius='10px';
  el.style.boxShadow='0 6px 18px rgba(0,0,0,0.12)';
  el.style.fontSize='14px';
  el.style.color=(type==='danger')?'#fff':'#07250f';
  el.style.background=(type==='danger')?'#c0392b':(type==='success')?'#2ecc71':'#f0f4ef';
  document.getElementById('vasudha-toast-container').appendChild(el);
  setTimeout(()=>el.remove(), timeout);
}
function setBusy(btn, busy=true){
  if(!btn) return;
  btn.disabled = busy;
  if(busy){ btn.dataset.orig = btn.innerHTML; btn.innerHTML = 'Please wait…'; btn.style.opacity='0.7'; }
  else { if(btn.dataset.orig) btn.innerHTML = btn.dataset.orig; btn.style.opacity='1'; }
}

/* Registration: call server endpoint */
async function handleRegister(e){
  e.preventDefault();
  const form = e.target;
  const first = (form.querySelector('#first')?.value||'').trim();
  const last = (form.querySelector('#last')?.value||'').trim();
  const email = (form.querySelector('#email')?.value||'').trim();
  const password = (form.querySelector('#password1')?.value||'').trim();
  const phone = (form.querySelector('#phone')?.value||'').trim();
  const username = (form.querySelector('#usernameReg')?.value||'').trim();
  const role = (form.querySelector('#accountType')?.value||'buyer').trim();
  const btn = form.querySelector('button[type="submit"]');
  if(!first||!email||!password){ toast('Please fill required fields.', 'danger'); return; }
  setBusy(btn,true);
  try{
    const resp = await fetch('/api/register', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ first, last, email, password, phone, username, role })
    });
    const data = await resp.json();
    if(!resp.ok){ toast(data?.error || 'Registration failed', 'danger'); setBusy(btn,false); return; }
    toast(data?.message || 'Registered. You can login now.', 'success');
    setTimeout(()=> window.location.href = '/login.html', 1200);
  }catch(err){
    console.error(err);
    toast('Network error during registration', 'danger');
  }finally{ setBusy(btn,false); }
}

/* Login (client-side using anon key) */
async function handleLogin(e){
  e.preventDefault();
  const form = e.target;
  const email = (form.querySelector('#username')?.value||'').trim();
  const password = (form.querySelector('#password')?.value||'').trim();
  const btn = form.querySelector('button[type="submit"]');
  if(!email||!password){ toast('Please enter email and password', 'danger'); return; }
  setBusy(btn,true);
  try{
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if(error){ throw error; }
    const session = data?.session || null;
    if(!session){ toast('Login succeeded but no session returned', 'info'); setBusy(btn,false); return; }
    // fetch profile to determine role
    const user = session.user;
    const { data: profile, error: pErr } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const role = profile?.role || 'buyer';
    toast('Login successful', 'success');
    setTimeout(()=> {
      if(role === 'admin') window.location.href = '/admin/index.html';
      else if(role === 'verifier') window.location.href = '/verifier.html';
      else if(role === 'field_user') window.location.href = '/field-user.html';
      else window.location.href = '/buyer.html';
    }, 800);
  }catch(err){
    console.error('login error', err);
    toast(err?.message || 'Login failed', 'danger');
  }finally{ setBusy(btn,false); }
}

/* DOM init */
function init() {
  const reg = document.getElementById('registerForm'); if(reg) reg.addEventListener('submit', handleRegister);
  const login = document.getElementById('loginForm'); if(login) login.addEventListener('submit', handleLogin);
  // create toast container
  if(!document.getElementById('vasudha-toast-container')) {
    const c = document.createElement('div'); c.id='vasudha-toast-container';
    Object.assign(c.style,{position:'fixed',right:'18px',top:'18px',zIndex:99999,display:'flex',flexDirection:'column',gap:'10px'});
    document.body.appendChild(c);
  }
}
document.addEventListener('DOMContentLoaded', init);
window._vasudha_supabase_client = { supabase };
JS

# 6) Frontend pages (polished register + login)
cat > public/user-register.html <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Create account — Vasudha</title>
<link rel="stylesheet" href="/css/auth-forms.css">
<style>
/* inline fallback styles */
body{font-family:Georgia,serif;background:#f8fbf8;color:#093014;margin:0;padding:34px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{max-width:940px;width:100%;background:#fff;border-radius:14px;padding:28px;box-shadow:0 12px 44px rgba(0,0,0,0.06)}
h1{margin:0 0 6px;font-size:28px}
.sub{color:#496a55;margin-bottom:18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
label{font-weight:700;margin-bottom:6px;display:block}
input,select{padding:12px;border-radius:10px;border:1px solid #e6efe6;background:#f5fbf5;width:100%}
.actions{display:flex;gap:12px;justify-content:center;margin-top:18px}
.btn{background:linear-gradient(#2f6b3a,#244f2d);color:#fff;padding:12px 20px;border-radius:10px;border:none;font-weight:700;cursor:pointer}
.note{font-size:13px;color:#5b7a64;margin-top:12px;text-align:center}
small.terms{display:block;margin-top:10px;color:#6e8a70}
@media(max-width:880px){ .grid{grid-template-columns:1fr} }
</style>
</head>
<body>
  <main class="card" role="main" aria-labelledby="rtitle">
    <h1 id="rtitle">Create your account</h1>
    <div class="sub">Register to use Vasudha — create projects, buy & verify carbon credits.</div>

    <form id="registerForm" novalidate>
      <div class="grid">
        <div>
          <label for="first">First name *</label>
          <input id="first" name="first" required placeholder="First name">
        </div>
        <div>
          <label for="last">Last name</label>
          <input id="last" name="last" placeholder="Last name">
        </div>

        <div>
          <label for="email">Email *</label>
          <input id="email" name="email" type="email" required placeholder="you@example.com">
        </div>
        <div>
          <label for="usernameReg">Username (optional)</label>
          <input id="usernameReg" name="usernameReg" placeholder="Preferred username">
        </div>

        <div>
          <label for="password1">Password *</label>
          <input id="password1" name="password1" type="password" required placeholder="At least 8 characters">
        </div>
        <div>
          <label for="phone">Phone</label>
          <input id="phone" name="phone" type="tel" placeholder="+91 98765 43210">
        </div>

        <div style="grid-column:1/-1">
          <label for="accountType">Account type</label>
          <select id="accountType" name="accountType">
            <option value="buyer">Buyer</option>
            <option value="project_owner">Project Owner</option>
            <option value="verifier">Verifier</option>
            <option value="field_user">Field User</option>
          </select>
          <small class="terms">Admin accounts are not allowed to self-register. Contact administrator for admin access.</small>
        </div>
      </div>

      <div style="margin-top:12px">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600">
          <input type="checkbox" id="agree" required> I accept the <a href="/terms.html">Terms & Conditions</a>.
        </label>
      </div>

      <div class="actions">
        <button class="btn" type="submit">Create account</button>
        <a href="/login.html" class="btn" style="background:#fff;color:#244f2d;border:2px solid #d6e6d6;text-decoration:none;display:inline-flex;align-items:center;justify-content:center">Already have account</a>
      </div>

      <div class="note">By registering you agree to our Terms & Conditions. <small>Certain accounts (admin, disposable emails, offensive usernames) are not permitted.</small></div>
    </form>
  </main>

<script type="module" src="/js/auth.js"></script>
</body>
</html>
HTML

cat > public/login.html <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Login — Vasudha</title>
<style>
body{font-family:Georgia,serif;background:#f6fbf6;color:#093014;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{width:760px;max-width:96%;background:#fff;border-radius:16px;padding:28px;box-shadow:0 12px 36px rgba(0,0,0,0.06)}
h2{font-size:28px;margin:0 0 8px}
.muted{color:#6b8b74;margin-bottom:12px}
.input{margin-bottom:12px}
label{display:block;font-weight:700;margin-bottom:6px}
input{padding:12px;border-radius:10px;border:1px solid #e6efe6;background:#f4faf4;width:100%}
.btn{background:linear-gradient(#2f6b3a,#244f2d);color:#fff;padding:12px 18px;border-radius:10px;border:none;font-weight:700;cursor:pointer}
.links{display:flex;justify-content:space-between;align-items:center;margin-top:8px}
@media(max-width:560px){ .card{padding:18px} }
</style>
</head>
<body>
  <main class="card" role="main" aria-labelledby="ltitle">
    <h2 id="ltitle">Welcome back</h2>
    <div class="muted">Sign in with the email you used to register.</div>

    <form id="loginForm" novalidate>
      <div class="input">
        <label for="username">Email</label>
        <input id="username" name="username" type="email" required placeholder="you@example.com">
      </div>

      <div class="input">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required placeholder="Enter password">
      </div>

      <div class="links">
        <a href="/user-register.html" style="color:#2f6b3a;text-decoration:none">Create account</a>
        <button class="btn" type="submit">Sign in</button>
      </div>
    </form>
  </main>

<script type="module" src="/js/auth.js"></script>
</body>
</html>
HTML

# 7) Add small README for server usage
cat > server/README.md <<'MD'
# Vasudha backend (Supabase registration)

1. Copy `server/.env.example` to `.env` and fill:
   - SUPABASE_URL=https://yourproject.supabase.co
   - SUPABASE_SERVICE_ROLE=your-service-role-key
   - CORS_ORIGIN=http://localhost:8000
   - PORT=8787

2. Start server:
   cd server
   npm start

3. When deployed, host this server (Heroku/Vercel serverless/Render). The frontend will POST to /api/register.
MD

# 8) Commit & push
git add sql server public/js public/user-register.html public/login.html || true
git commit -m "Add Supabase backend registration API, client integration, T&C enforcement, and polished auth pages" || echo "Nothing to commit"
git push -u origin HEAD || echo "Push failed - run 'git push' manually"

# 9) Final instructions printed to user
cat <<'INSTR'

SETUP DONE (files created). Next steps YOU MUST DO:

1) Set environment variables for server:
   - Create server/.env from server/.env.example
   - Fill SUPABASE_URL and SUPABASE_SERVICE_ROLE (service role key) in server/.env
   - Start server: cd server && npm start
   - For local frontend testing serve public/: cd public && python3 -m http.server 8000
     - Ensure CORS_ORIGIN in server/.env includes http://localhost:8000

2) Frontend config:
   - Edit public/js/config.js and set SUPABASE_URL and SUPABASE_ANON_KEY (anon/publishable). Alternatively, during deployment use build step to write config from env.

3) Run SQL to create profiles table (if you haven't):
   - Use Supabase SQL editor or:
       psql ... or supabase db query < sql/create_profiles.sql

4) Deploy server to a host (Heroku / Render / Vercel serverless functions).
   - When deploying, set SUPABASE_SERVICE_ROLE as an environment variable in the host.
   - Expose HTTPS endpoint; update frontend if register endpoint path changes.

5) Terms & Conditions enforced by server:
   - Admin self-register blocked.
   - Disposable email domains blocked.
   - Offensive/banned words blocked in username.
   - Phone required for project_owner and field_user.
   - Duplicate usernames blocked.
   - Password min length 8.

6) Test flow:
   - Start server and static site locally.
   - Visit http://localhost:8000/user-register.html and try to register valid and invalid cases.
   - If registration succeeds, check Supabase -> Authentication -> Users and Table Editor -> public.profiles for created rows.

If anything errors during the script (npm install, git push), copy the terminal output and paste here and I'll fix it immediately.

INSTR
