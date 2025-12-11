/*
  public/js/auth.js  — improved front-end auth for Supabase
  Expects /js/config.js exporting SUPABASE_URL and SUPABASE_ANON_KEY
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function makeToastContainer() {
  if (document.getElementById('vasudha-toast-container')) return;
  const c = document.createElement('div');
  c.id = 'vasudha-toast-container';
  Object.assign(c.style, { position:'fixed', right:'18px', top:'18px', zIndex:99999, display:'flex', flexDirection:'column', gap:'10px' });
  document.body.appendChild(c);
}
function toast(msg, type='info', timeout=4500){
  makeToastContainer();
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.padding = '10px 14px';
  el.style.borderRadius = '10px';
  el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
  el.style.fontSize = '14px';
  el.style.color = (type==='danger')? '#fff' : '#07250f';
  el.style.background = (type==='danger')? '#c0392b' : (type==='success')? '#2ecc71' : '#f0f4ef';
  document.getElementById('vasudha-toast-container').appendChild(el);
  setTimeout(()=> el.remove(), timeout);
}
function setBusy(btn, busy=true){
  if(!btn) return;
  btn.disabled = busy;
  if(busy){ btn.dataset.orig = btn.innerHTML; btn.innerHTML = 'Please wait…'; btn.style.opacity='0.7'; }
  else { if(btn.dataset.orig) btn.innerHTML = btn.dataset.orig; btn.style.opacity='1'; }
}

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
  setBusy(btn, true);
  try{
    const { data, error } = await supabase.auth.signUp({ email, password });
    if(error) throw error;
    const user = data?.user;
    const full_name = `${first} ${last}`.trim();
    if(user && user.id){
      const { error: pErr } = await supabase.from('profiles').insert([{ id: user.id, full_name, username: username||null, phone: phone||null, role }]);
      if(pErr){ console.warn('profile err', pErr); toast('Registered but profile save failed.', 'danger'); setBusy(btn,false); return; }
      toast('Registration successful. Redirecting to login...', 'success', 2000);
      setTimeout(()=> window.location.href = '/login.html', 1200);
    } else {
      toast('Registration submitted. Please check your email to confirm (if required).', 'info', 7000);
    }
  }catch(err){
    console.error('register error', err);
    toast(err?.message || 'Registration failed', 'danger');
  }finally{ setBusy(btn,false); }
}

async function handleLogin(e){
  e.preventDefault();
  const form = e.target;
  const identifier = (form.querySelector('#username')?.value||'').trim();
  const password = (form.querySelector('#password')?.value||'').trim();
  const btn = form.querySelector('button[type="submit"]');
  if(!identifier||!password){ toast('Please enter email and password.', 'danger'); return; }
  setBusy(btn, true);
  try{
    let emailToUse = identifier;
    if(!identifier.includes('@')){
      const { data: rows } = await supabase.from('profiles').select('id, username').eq('username', identifier).limit(1);
      if(rows && rows.length){ toast('Please login with the email used during registration.', 'info', 6000); setBusy(btn,false); return; }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: emailToUse, password });
    if(error) throw error;
    const session = data?.session || data;
    const user = session?.user;
    if(!user){ toast('Login succeeded but session missing.', 'info'); setBusy(btn,false); return; }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const role = profile?.role || 'buyer';
    toast('Login successful. Redirecting...', 'success', 1200);
    setTimeout(()=> {
      if(role==='admin') window.location.href = '/admin/index.html';
      else if(role==='verifier') window.location.href = '/verifier.html';
      else if(role==='field_user') window.location.href = '/field-user.html';
      else window.location.href = '/buyer.html';
    },900);
  }catch(err){
    console.error('login error', err);
    toast(err?.message || 'Login failed', 'danger');
  }finally{ setBusy(btn,false); }
}

async function checkSessionProtect(){
  const { data } = await supabase.auth.getSession();
  const s = data?.session || null;
  if(!s){ window.location.href = '/login.html'; return false; }
  return true;
}

function init(){
  const reg = document.getElementById('registerForm'); if(reg) reg.addEventListener('submit', handleRegister);
  const login = document.getElementById('loginForm'); if(login) login.addEventListener('submit', handleLogin);
  makeToastContainer();
}
document.addEventListener('DOMContentLoaded', init);

window._vasudha_supabase = { supabase, handleRegister, handleLogin, checkSessionProtect };
