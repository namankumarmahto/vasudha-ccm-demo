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
