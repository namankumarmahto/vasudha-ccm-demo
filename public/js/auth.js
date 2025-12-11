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
