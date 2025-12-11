import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function log(...a){ try{ console.log('[VASUDHA DEBUG]', ...a); }catch(e){} }
function toast(msg){ try{ alert(msg); }catch(e){ console.log(msg); } }

export async function handleRegisterForm(e){
  e.preventDefault();
  const f = e.target;
  const first = (f.querySelector('#first')?.value||'').trim();
  const email = (f.querySelector('#email')?.value||'').trim();
  const password = (f.querySelector('#password1')?.value||'').trim();
  if(!first||!email||!password){ toast('Fill required fields'); return; }
  log('Attempting signUp', {email});
  try{
    const res = await supabase.auth.signUp({ email, password });
    log('signUp response', res);
    if(res.error){ toast('signup error: '+res.error.message); return; }
    // try to get user id (may be null if email confirm required)
    const userId = res?.data?.user?.id || res?.user?.id || null;
    log('userId after signup', userId);
    // attempt insert regardless, but capture error
    const profilePayload = { id: userId, full_name: first, email };
    log('inserting profile', profilePayload);
    const insert = await supabase.from('profiles').insert([profilePayload]);
    log('insert response', insert);
    if(insert.error){ toast('profile insert error: '+insert.error.message); return; }
    toast('Registered — check console for details');
  }catch(err){ log('exception signup', err); toast('signup exception: '+err.message); }
}

// login debug
export async function handleLoginForm(e){
  e.preventDefault();
  const f = e.target;
  const email = (f.querySelector('#username')?.value||'').trim();
  const password = (f.querySelector('#password')?.value||'').trim();
  if(!email||!password){ toast('enter credentials'); return; }
  log('Attempting signInWithPassword', {email});
  try{
    const res = await supabase.auth.signInWithPassword({ email, password });
    log('signin response', res);
    if(res.error){ toast('signin error: '+res.error.message); return; }
    const session = res?.data?.session || res?.session || null;
    const user = session?.user || res?.user || null;
    log('session,user', session, user);
    if(!user){ toast('no user returned by signup - maybe confirm required'); return; }
    // check profile exist
    const prof = await supabase.from('profiles').select('*').eq('id', user.id).single();
    log('profile lookup', prof);
    if(prof.error || !prof.data){ toast('no profile found') ; await supabase.auth.signOut(); return; }
    toast('login success, profile found');
  }catch(err){ log('signin exception', err); toast('signin exception: '+err.message); }
}

document.addEventListener('DOMContentLoaded', ()=>{
  const reg = document.getElementById('registerForm');
  if(reg) reg.addEventListener('submit', handleRegisterForm);
  const login = document.getElementById('loginForm');
  if(login) login.addEventListener('submit', handleLoginForm);
});
window._vasudha = window._vasudha || {}; window._vasudha.supabase = supabase;
