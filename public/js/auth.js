/*
  public/js/auth.js
  - Uses stable esm.sh @supabase/supabase-js
  - Contains registration + robust login (only registered profiles allowed)
  - Exposes simple toast + console logs for debugging
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- small UI helpers ---
function toast(msg, type='info', t=4000){
  try{
    const containerId = 'vasudha-toast';
    let container = document.getElementById(containerId);
    if(!container){
      container = document.createElement('div');
      container.id = containerId;
      Object.assign(container.style, { position:'fixed', right:'18px', top:'18px', zIndex:99999, display:'flex', flexDirection:'column', gap:'8px' });
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, { padding:'10px 14px', borderRadius:'8px', boxShadow:'0 8px 20px rgba(0,0,0,0.08)', maxWidth:'320px' });
    if(type==='danger'){ el.style.background='#e74c3c'; el.style.color='#fff'; }
    else if(type==='success'){ el.style.background='#2ecc71'; el.style.color='#07250f'; }
    else { el.style.background='#f0fff4'; el.style.color='#07250f'; }
    container.appendChild(el);
    setTimeout(()=> el.remove(), t);
  }catch(e){ console.log('toast fallback', msg); try{ alert(msg) }catch(_){} }
}

function setBusy(btn, busy=true){
  if(!btn) return;
  if(busy){ btn.disabled = true; btn.dataset.orig = btn.innerHTML; btn.innerHTML = 'Please wait…'; btn.style.opacity='0.7'; }
  else { btn.disabled = false; if(btn.dataset.orig) btn.innerHTML = btn.dataset.orig; btn.style.opacity='1'; }
}

// --- registration (kept for completeness) ---
export async function handleRegisterForm(e){
  e.preventDefault();
  const form = e.target;
  const first = (form.querySelector('#first')?.value||'').trim();
  const last = (form.querySelector('#last')?.value||'').trim();
  const email = (form.querySelector('#email')?.value||'').trim();
  const password = (form.querySelector('#password1')?.value||'').trim();
  const username = (form.querySelector('#usernameReg')?.value||'').trim();
  const phone = (form.querySelector('#phone')?.value||'').trim();
  const role = (form.querySelector('#accountType')?.value||'buyer').trim();
  const agree = !!form.querySelector('#agree')?.checked;
  const btn = form.querySelector('button[type="submit"]');

  if(!first || !email || !password){ toast('Please fill required fields (name, email, password)', 'danger'); return; }
  if(!agree){ toast('You must accept Terms & Conditions', 'danger'); return; }

  setBusy(btn,true);
  try{
    const { data: signData, error: signErr } = await supabase.auth.signUp({ email, password });
    if(signErr){
      console.error('signup error', signErr);
      toast(signErr.message || 'Signup failed', 'danger');
      setBusy(btn,false);
      return;
    }

    // If immediate user object returned (no email confirmation required), we insert profile
    const userId = signData?.user?.id || null;

    if(userId){
      const { error: profileErr } = await supabase.from('profiles').insert([{
        id: userId,
        full_name: `${first}${last ? ' ' + last : ''}`,
        username: username || null,
        email,
        phone: phone || null,
        role,
        approved: true
      }]);
      if(profileErr){
        console.error('profile insert error', profileErr);
        toast('Registered but failed to save profile. Contact admin.', 'danger');
        setBusy(btn,false);
        return;
      }
      toast('Registration successful — please login', 'success');
      setTimeout(()=> window.location.href = '/login.html', 1200);
    } else {
      // If email confirmation required, guide user
      toast('Registration submitted. Please confirm your email (check inbox).', 'info');
    }
  }catch(err){
    console.error('register exception', err);
    toast(err?.message || 'Registration error', 'danger');
  }finally{
    setBusy(btn,false);
  }
}

// --- ROBUST LOGIN (ONLY REGISTERED USERS ALLOWED) ---
export async function handleLoginForm(e){
  e.preventDefault();
  const form = e.target;
  const email = (form.querySelector('#username')?.value||'').trim();
  const password = (form.querySelector('#password')?.value||'').trim();
  const btn = form.querySelector('button[type="submit"]');

  if(!email || !password){ toast('Enter email and password', 'danger'); return; }
  setBusy(btn,true);

  try{
    // 1) Attempt sign-in
    const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({ email, password });

    // If Supabase returns an error (invalid credentials), stop
    if(signErr){
      console.error('signIn error', signErr);
      toast(signErr.message || 'Invalid credentials', 'danger');
      setBusy(btn,false);
      return;
    }

    // 2) Get user from returned session/data
    const session = signData?.data?.session || signData?.session || null;
    const user = session?.user || signData?.user || null;

    // If no user object returned, it could be because email confirmation is required
    if(!user){
      // Try to fetch user by email from auth.users (only via admin/server) — cannot from client
      toast('Login step incomplete. Check if your email is confirmed.', 'danger');
      setBusy(btn,false);
      return;
    }

    // 3) Verify profile exists in public.profiles
    const { data: profile, error: profileErr } = await supabase.from('profiles').select('id,role,approved').eq('id', user.id).single();

    if(profileErr || !profile){
      // No profile => block login (security), log out, inform user
      console.warn('profile missing for user', user.id, profileErr);
      await supabase.auth.signOut();
      toast('No registration record found. Please register first.', 'danger');
      setBusy(btn,false);
      return;
    }

    // 4) If profile exists but not approved
    if(profile.approved === false){
      await supabase.auth.signOut();
      toast('Your account is not approved yet. Contact admin.', 'info');
      setBusy(btn,false);
      return;
    }

    // 5) All good -> redirect by role
    toast('Login successful. Redirecting...', 'success', 1000);
    setTimeout(()=>{
      const role = profile.role || 'buyer';
      if(role === 'admin') window.location.href = '/admin/index.html';
      else if(role === 'verifier') window.location.href = '/verifier.html';
      else if(role === 'field_user') window.location.href = '/field-user.html';
      else window.location.href = '/buyer.html';
    },900);

  }catch(err){
    console.error('login exception', err);
    toast(err?.message || 'Login failed', 'danger');
  }finally{
    setBusy(btn,false);
  }
}

// --- Init form listeners ---
document.addEventListener('DOMContentLoaded', ()=>{
  const reg = document.getElementById('registerForm');
  if(reg) reg.addEventListener('submit', handleRegisterForm);

  const login = document.getElementById('loginForm');
  if(login) login.addEventListener('submit', handleLoginForm);
});

window._vasudha = window._vasudha || {};
window._vasudha.supabase = supabase;
