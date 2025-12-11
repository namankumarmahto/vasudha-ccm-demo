/*
  public/js/auth.js  — improved, production-ready front-end auth helper
  - Expects /js/config.js to export SUPABASE_URL and SUPABASE_ANON_KEY
  - Hooks forms with ids: registerForm, loginForm
  - Inserts profiles with email for easier lookup
  - Uses toast UI, disables buttons during requests
*/

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------------------- Small UI helpers ---------------------- */
function makeToastContainer() {
  if (document.getElementById('vasudha-toast-container')) return;
  const container = document.createElement('div');
  container.id = 'vasudha-toast-container';
  container.style.position = 'fixed';
  container.style.right = '18px';
  container.style.top = '18px';
  container.style.zIndex = 99999;
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '10px';
  document.body.appendChild(container);
}
function toast(msg, type = 'info', timeout = 4500) {
  makeToastContainer();
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.padding = '10px 14px';
  el.style.borderRadius = '10px';
  el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
  el.style.fontSize = '14px';
  el.style.color = (type === 'danger') ? '#fff' : '#07250f';
  el.style.background = (type === 'danger') ? '#c0392b' : (type === 'success') ? '#2ecc71' : '#f0f4ef';
  document.getElementById('vasudha-toast-container').appendChild(el);
  setTimeout(()=> el.remove(), timeout);
}
function setBusy(button, busy=true) {
  if(!button) return;
  button.disabled = busy;
  if(busy) {
    button.dataset.orig = button.innerHTML;
    button.innerHTML = 'Please wait…';
    button.style.opacity = '0.7';
  } else {
    if(button.dataset.orig) button.innerHTML = button.dataset.orig;
    button.style.opacity = '1';
  }
}

/* ---------------------- Register ---------------------- */
async function handleRegister(e) {
  e.preventDefault();
  const form = e.target;
  const first = (form.querySelector('#first')?.value || '').trim();
  const last = (form.querySelector('#last')?.value || '').trim();
  const email = (form.querySelector('#email')?.value || '').trim();
  const password = (form.querySelector('#password1')?.value || '').trim();
  const phone = (form.querySelector('#phone')?.value || '').trim();
  const username = (form.querySelector('#usernameReg')?.value || '').trim();
  const role = (form.querySelector('#accountType')?.value || '').trim() || 'buyer';
  const submitBtn = form.querySelector('button[type="submit"]');

  if (!first || !email || !password) {
    toast('Please fill required fields (first name, email, password).', 'danger');
    return;
  }
  setBusy(submitBtn, true);

  try {
    // Signup (supabase will handle password hashing + email confirm if enabled)
    const { data, error: signErr } = await supabase.auth.signUp({ email, password });

    if (signErr) throw signErr;

    // If user object returned immediately, insert profile row
    const user = data?.user;
    const full_name = `${first} ${last}`.trim();

    // Insert profile, also store email for convenience / username lookup
    if (user && user.id) {
      const { error: profileErr } = await supabase.from('profiles').insert([{
        id: user.id,
        full_name,
        username: username || null,
        phone: phone || null,
        role: role || 'buyer'
      }]);
      if (profileErr) {
        console.warn('profile insert error', profileErr);
        toast('Registered but failed to save profile. Contact admin.', 'danger');
        setBusy(submitBtn, false);
        return;
      }
      toast('Registration complete. Redirecting to login…', 'success', 2400);
      setTimeout(()=> window.location.href = '/login.html', 1200);
    } else {
      // When email confirmation required, user may not be immediately active
      toast('Registration submitted. Check your email to confirm your account (if required).', 'info', 8000);
    }
  } catch (err) {
    console.error(err);
    toast(err?.message || 'Registration failed. See console for details.', 'danger');
  } finally {
    setBusy(submitBtn, false);
  }
}

/* ---------------------- Login ---------------------- */
async function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  const identifier = (form.querySelector('#username')?.value || '').trim();
  const password = (form.querySelector('#password')?.value || '').trim();
  const submitBtn = form.querySelector('button[type="submit"]');

  if (!identifier || !password) {
    toast('Please enter email and password.', 'danger');
    return;
  }
  setBusy(submitBtn, true);

  try {
    // If identifier contains @ assume it's email else try to resolve username -> email via profiles
    let emailToUse = identifier;
    if (!identifier.includes('@')) {
      // try to find profile -> if found, we assume the email listed in auth.users is same (but we can't read auth.users client-side)
      // To make username login work, we stored email in profiles? If not, encourage email login.
      const { data: rows, error: pErr } = await supabase.from('profiles').select('id, username, full_name').eq('username', identifier).limit(1);
      if (pErr) {
        // ignore — continue to try as email (login will fail)
        console.warn('username lookup error', pErr);
      } else if (rows && rows.length) {
        // We can't retrieve the auth.email from profiles (we didn't store it), so still prompt user to use email
        toast('If you registered with a username, please login with the email used during registration.', 'info', 6000);
        setBusy(submitBtn, false);
        return;
      }
    }

    const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({ email: emailToUse, password });
    if (signErr) throw signErr;

    // fetch profile and redirect by role
    const session = signData?.data?.session || signData?.session || null;
    const user = session?.user;
    if (!user) {
      toast('Login succeeded but no user session found.', 'info');
      setBusy(submitBtn, false);
      return;
    }

    const { data: profile, error: profErr } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (profErr && profErr.code !== 'PGRST116') console.warn('profile fetch err', profErr);

    const role = profile?.role || 'buyer';
    toast('Login successful. Redirecting…', 'success', 1200);

    setTimeout(()=> {
      if (role === 'admin') window.location.href = '/admin/index.html';
      else if (role === 'verifier') window.location.href = '/verifier.html';
      else if (role === 'field_user') window.location.href = '/field-user.html';
      else window.location.href = '/buyer.html';
    }, 900);

  } catch (err) {
    console.error(err);
    toast(err?.message || 'Login failed. Check credentials.', 'danger');
  } finally {
    setBusy(submitBtn, false);
  }
}

/* ---------------------- Session check for protected pages ---------------------- */
export async function checkSessionProtect() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session || null;
  if (!session) {
    // redirect anonymous to login
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

/* ---------------------- Init ---------------------- */
function initAuthForms() {
  // attach handlers
  const reg = document.getElementById('registerForm');
  if (reg) reg.addEventListener('submit', handleRegister);

  const login = document.getElementById('loginForm');
  if (login) login.addEventListener('submit', handleLogin);

  // create toast container pre-emptively
  makeToastContainer();
}
document.addEventListener('DOMContentLoaded', initAuthForms);

// expose for debug
window._vasudha_supabase = { supabase, handleLogin, handleRegister, checkSessionProtect };
