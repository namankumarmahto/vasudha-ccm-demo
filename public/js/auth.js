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
