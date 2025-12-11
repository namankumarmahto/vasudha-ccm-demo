import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// simple toast fallback
function toast(msg, type='info'){
  try {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.position='fixed';
    el.style.right='18px';
    el.style.top='18px';
    el.style.zIndex='99999';
    el.style.padding='10px 14px';
    el.style.borderRadius='10px';
    el.style.boxShadow='0 6px 18px rgba(0,0,0,0.08)';
    el.style.background = (type==='danger')? '#e74c3c' : (type==='success')? '#2ecc71' : '#f0fdf4';
    el.style.color = (type==='danger')? '#fff' : '#07250f';
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 3500);
  } catch(e){ alert(msg); }
}

async function createProfileIfMissing(userId, payload){
  // returns true on success
  try {
    const { error } = await supabase.from('profiles').insert([{
      id: userId,
      full_name: payload.full_name || null,
      username: payload.username || null,
      email: payload.email || null,
      phone: payload.phone || null,
      role: payload.role || 'buyer',
      approved: true
    }]);
    if(error) {
      console.error('profiles insert error', error);
      return false;
    }
    return true;
  } catch(err){
    console.error(err);
    return false;
  }
}

// Registration handler
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

  if(!first || !email || !password){
    toast('Please fill required fields (name, email, password)', 'danger'); return;
  }
  if(!agree){ toast('You must accept Terms & Conditions', 'danger'); return; }

  // create user (supabase auth)
  try {
    const { data: signData, error: signErr } = await supabase.auth.signUp({ email, password });
    if(signErr){
      console.error('signup error', signErr);
      toast(signErr.message || 'Signup failed', 'danger');
      return;
    }

    const userId = signData?.user?.id;
    if(!userId){
      // maybe email confirmation required: instruct user
      toast('Signup successful. Please confirm your email if required.', 'info');
      return;
    }

    // insert profile row
    const success = await createProfileIfMissing(userId, {
      full_name: first + (last ? ' ' + last : ''),
      username, email, phone, role
    });
    if(!success){
      toast('Registered but saving profile failed. Check server logs.', 'danger');
      return;
    }

    toast('Registration successful — redirecting to login...', 'success');
    setTimeout(()=> window.location.href = '/login.html', 1200);

  } catch(err){
    console.error('register exception', err);
    toast(err?.message || 'Registration error', 'danger');
  }
}

// Login handler
export async function handleLoginForm(e){
  e.preventDefault();
  const form = e.target;
  const email = (form.querySelector('#username')?.value||'').trim();
  const password = (form.querySelector('#password')?.value||'').trim();
  if(!email || !password){ toast('Enter email and password', 'danger'); return; }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if(error){
      console.error('signin error', error);
      toast(error.message || 'Login failed', 'danger'); return;
    }

    // Get session user id
    const user = data?.user || (data?.session?.user);
    if(!user){
      toast('No user session; check Supabase', 'danger'); return;
    }

    // ensure profile exists
    const { data: profile, error: pe } = await supabase.from('profiles').select('id,role,approved').eq('id', user.id).single();
    if(pe || !profile){
      await supabase.auth.signOut();
      toast('No registration found for this account. Please register first.', 'danger');
      return;
    }
    if(profile.approved === false){
      await supabase.auth.signOut();
      toast('Account not approved yet. Contact admin.', 'info');
      return;
    }

    // redirect by role
    toast('Login successful. Redirecting...', 'success');
    setTimeout(()=>{
      const role = profile.role || 'buyer';
      if(role === 'admin') window.location.href = '/admin/index.html';
      else if(role === 'verifier') window.location.href = '/verifier.html';
      else if(role === 'field_user') window.location.href = '/field-user.html';
      else window.location.href = '/buyer.html';
    },800);
  } catch(err){
    console.error('login exception', err);
    toast(err?.message || 'Login failed', 'danger');
  }
}

// wire up forms
document.addEventListener('DOMContentLoaded', ()=>{
  const reg = document.getElementById('registerForm');
  if(reg) reg.addEventListener('submit', handleRegisterForm);

  const login = document.getElementById('loginForm');
  if(login) login.addEventListener('submit', handleLoginForm);
});

// expose for debugging
window._vasudha = window._vasudha || {};
window._vasudha.supabase = supabase;
