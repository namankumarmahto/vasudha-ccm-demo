/*
  public/js/auth.js
  ES module for Supabase auth (sign-up, sign-in). Expects public/js/config.js to export:
    SUPABASE_URL, SUPABASE_ANON_KEY

  This file hooks forms with ids: registerForm, loginForm.
  It also redirects based on profile.role after login.
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function showMsg(msg){
  // Replace with nicer UI if you want
  alert(msg);
}

/* ---------- Registration ---------- */
async function handleRegister(e){
  e.preventDefault();
  try{
    const form = e.target;
    const first = (form.querySelector('#first')?.value || '').trim();
    const last = (form.querySelector('#last')?.value || '').trim();
    const email = (form.querySelector('#email')?.value || '').trim();
    const password = (form.querySelector('#password1')?.value || '').trim();
    const role = (form.querySelector('#accountType')?.value || '').trim() || 'buyer';
    const phone = (form.querySelector('#phone')?.value || '').trim();
    const username = (form.querySelector('#usernameReg')?.value || '').trim();

    if(!first || !email || !password){
      return showMsg('Please fill required fields (first name, email, password).');
    }

    const { data: signData, error: signErr } = await supabase.auth.signUp({
      email, password
    });

    if(signErr){
      throw signErr;
    }

    // If email confirmation is required, user object might be null; handle gracefully
    const user = signData.user;
    const full_name = (first + ' ' + last).trim();

    if(user && user.id){
      const { error: profErr } = await supabase.from('profiles').insert([{
        id: user.id,
        full_name,
        username,
        phone,
        role
      }]);
      if(profErr){
        console.error('profile insert error', profErr);
        showMsg('Registered but failed to save profile (contact admin).');
        return;
      }
      showMsg('Registration successful — you may now log in.');
      window.location.href = '/login.html';
      return;
    }

    // If we are here, signUp succeeded but user not returned (email confirmation flow)
    showMsg('Registration submitted. Check your email for confirmation if enabled.');
  }catch(err){
    console.error('register error', err);
    showMsg(err?.message || JSON.stringify(err) || 'Registration failed.');
  }
}

/* ---------- Login ---------- */
async function handleLogin(e){
  e.preventDefault();
  try{
    const form = e.target;
    const emailOrUsername = (form.querySelector('#username')?.value || '').trim();
    const password = (form.querySelector('#password')?.value || '').trim();

    if(!emailOrUsername || !password){
      return showMsg('Please enter username/email and password.');
    }

    // Try email sign-in first
    let signResult = await supabase.auth.signInWithPassword({
      email: emailOrUsername,
      password
    });

    // If sign-in failed and it might be a username, optionally look up profile (not recommended for email)
    if(signResult.error && !emailOrUsername.includes('@')){
      // try to find profile by username
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', emailOrUsername)
        .limit(1);
      if(pErr) { throw pErr; }
      if(profiles && profiles.length > 0){
        // NOTE: can't fetch email of auth.user from client — so encourage login with email
        showMsg('Please login using the email associated with this username.');
        return;
      }
    }

    if(signResult.error){
      throw signResult.error;
    }

    const session = signResult.data.session;
    const user = session.user;

    // fetch profile
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if(profErr && profErr.code !== 'PGRST116'){ console.warn('profile fetch err', profErr); }

    const role = profile?.role || 'buyer';
    if(role === 'admin') window.location.href = '/admin/index.html';
    else if(role === 'verifier') window.location.href = '/verifier.html';
    else if(role === 'field_user') window.location.href = '/field-user.html';
    else window.location.href = '/buyer.html';
  }catch(err){
    console.error('login error', err);
    showMsg(err?.message || JSON.stringify(err) || 'Login failed.');
  }
}

/* ---------- Session check for protected pages ---------- */
async function checkSession(){
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

async function initAuthForms(){
  const reg = document.getElementById('registerForm');
  if(reg) reg.addEventListener('submit', handleRegister);

  const login = document.getElementById('loginForm');
  if(login) login.addEventListener('submit', handleLogin);

  // auto protect pages whose <body data-protect="true">
  const protect = document.body?.dataset?.protect;
  if(protect === 'true'){
    const s = await checkSession();
    if(!s){
      window.location.href = '/login.html';
    }
  }
}

document.addEventListener('DOMContentLoaded', initAuthForms);

// expose for debug
window._vasudha_supabase = { supabase, handleLogin, handleRegister, checkSession };
