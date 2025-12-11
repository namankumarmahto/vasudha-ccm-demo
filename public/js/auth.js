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
