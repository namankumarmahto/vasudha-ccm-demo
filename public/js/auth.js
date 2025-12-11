/*
  public/js/auth.js
  - Uses public/js/config.js for SUPABASE_URL and SUPABASE_ANON_KEY
  - Implements registration validation, disposable-email blocking, terms enforcement,
    profile insertion with approved=false, login blocks if not approved, admin approval actions.
*/
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/js/config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ------------------ Utilities ------------------ */
const DISPOSABLE_DOMAINS = [
  "mailinator.com","10minutemail.com","temp-mail.org","tempmail.com","guerrillamail.com",
  "maildrop.cc","trashmail.com","fakeinbox.com","sharklasers.com"
];

function isDisposableEmail(email){
  try{
    const host = email.split('@')[1]?.toLowerCase();
    if(!host) return true;
    return DISPOSABLE_DOMAINS.some(d => host.endsWith(d) || host.includes(d));
  }catch(e){ return true; }
}

function isValidPhone(phone){
  const cleaned = (phone || '').replace(/\D/g,'');
  return cleaned.length >= 10 && cleaned.length <= 15;
}

function isValidUsername(u){
  if(!u) return false;
  if(u.length < 3) return false;
  // basic profanity filter - add more words if needed
  const blacklist = ['badword1','badword2','fuck','shit','bitch'];
  const low = u.toLowerCase();
  return !blacklist.some(w => low.includes(w));
}

function makeToastContainer(){ if(document.getElementById('vasudha-toast')) return; const c=document.createElement('div'); c.id='vasudha-toast'; Object.assign(c.style,{position:'fixed',right:'18px',top:'18px',zIndex:99999}); document.body.appendChild(c); }
function toast(msg,type='info',t=4500){ makeToastContainer(); const el=document.createElement('div'); el.textContent=msg; el.style.padding='10px 14px'; el.style.marginTop='8px'; el.style.borderRadius='8px'; el.style.boxShadow='0 6px 18px rgba(0,0,0,0.08)'; el.style.background = (type==='danger')? '#e74c3c' : (type==='success')? '#2ecc71' : '#f0fff4'; el.style.color = (type==='danger')? '#fff' : '#07250f'; document.getElementById('vasudha-toast').appendChild(el); setTimeout(()=>el.remove(),t); }

function setBusy(btn,b=true){ if(!btn) return; btn.disabled=b; if(b){ btn.dataset.orig=btn.innerHTML; btn.innerHTML='Please wait…'; btn.style.opacity='0.7'; } else { if(btn.dataset.orig) btn.innerHTML=btn.dataset.orig; btn.style.opacity='1'; } }

/* ------------------ Registration Handler ------------------ */
async function handleRegister(e){
  e.preventDefault();
  const form = e.target;
  const first = (form.querySelector('#first')?.value||'').trim();
  const last  = (form.querySelector('#last')?.value||'').trim();
  const email = (form.querySelector('#email')?.value||'').trim();
  const password = (form.querySelector('#password1')?.value||'').trim();
  const username = (form.querySelector('#usernameReg')?.value||'').trim();
  const phone = (form.querySelector('#phone')?.value||'').trim();
  const role = (form.querySelector('#accountType')?.value||'buyer').trim();
  const agree = form.querySelector('#agree')?.checked;
  const btn = form.querySelector('button[type="submit"]');

  // basic validations
  if(!first||!email||!password){ toast('Please fill required fields (first, email, password).','danger'); return; }
  if(!agree){ toast('You must accept Terms & Conditions to register.','danger'); return; }
  if(isDisposableEmail(email)){ toast('Disposable email addresses are not allowed. Use a real email.','danger'); return; }
  if(username && !isValidUsername(username)){ toast('Invalid username. Pick at least 3 alphanumeric characters, no profanity.','danger'); return; }
  if(phone && !isValidPhone(phone)){ toast('Phone number seems invalid. Include country code if needed.','danger'); return; }

  setBusy(btn,true);
  try{
    // Sign up via Supabase Auth
    const { data: signData, error: signErr } = await supabase.auth.signUp({ email, password });
    if(signErr){ throw signErr; }

    // If user object returned immediately, insert profiles row
    const user = signData?.user;
    const id = user?.id || null;
    const full_name = `${first} ${last}`.trim();

    // Insert profile with approved=false
    if(id){
      const { error: pErr } = await supabase.from('profiles').insert([{
        id,
        full_name,
        username: username || null,
        email,
        phone: phone || null,
        role,
        approved: false
      }]);
      if(pErr){ console.error('profile insert error', pErr); toast('Registered, but profile save failed. Contact admin.','danger'); return; }
      toast('Registration successful. Awaiting admin approval before you can log in.','success',7000);
      // optionally redirect to a "thank you" page or show message
      setTimeout(()=> window.location.href = '/login.html', 2200);
    } else {
      // Email confirmation flow: user must confirm via email
      toast('Registration submitted. Check your email for confirmation. Admin approval required afterwards.','info',10000);
    }
  }catch(err){
    console.error('register err', err);
    toast(err?.message || 'Registration error.','danger');
  }finally{
    setBusy(btn,false);
  }
}

/* ------------------ Login Handler ------------------ */
async function handleLogin(e){
  e.preventDefault();
  const form = e.target;
  const email = (form.querySelector('#username')?.value||'').trim();
  const password = (form.querySelector('#password')?.value||'').trim();
  const btn = form.querySelector('button[type="submit"]');

  if(!email || !password){ toast('Enter email and password.','danger'); return; }
  setBusy(btn,true);
  try{
    // Try sign-in
    const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    if(signErr){ throw signErr; }
    const session = signData?.data?.session || signData?.session || signData;
    const user = session?.user || null;
    if(!user){ toast('Login succeeded but no session found.','danger'); setBusy(btn,false); return; }

    // Fetch profile to check approved flag
    const { data: profile, error: profErr } = await supabase.from('profiles').select('id,role,approved,full_name').eq('id', user.id).single();
    if(profErr){
      // if no profile row exists, treat as unapproved
      console.warn('profile fetch error', profErr);
      toast('Account not approved or profile missing. Contact admin.','danger');
      await supabase.auth.signOut();
      setBusy(btn,false);
      return;
    }
    if(!profile.approved){
      await supabase.auth.signOut();
      toast('Your account is awaiting admin approval. You cannot log in until approved.','info',8000);
      setBusy(btn,false);
      return;
    }

    // success and redirection by role
    toast('Login successful. Redirecting…','success',1200);
    setTimeout(()=>{
      if(profile.role === 'admin') window.location.href = '/admin/index.html';
      else if(profile.role === 'verifier') window.location.href = '/verifier.html';
      else if(profile.role === 'field_user') window.location.href = '/field-user.html';
      else window.location.href = '/buyer.html';
    },900);
  }catch(err){
    console.error('login err', err);
    toast(err?.message || 'Login failed.','danger');
  }finally{
    setBusy(btn,false);
  }
}

/* ------------------ Admin Approvals (for admin page) ------------------ */
async function fetchPendingApprovals(){
  // returns pending profiles where approved=false
  const { data, error } = await supabase.from('profiles').select('id,full_name,username,email,role,created_at').eq('approved', false).order('created_at', { ascending: false });
  if(error){ console.error('fetch pending err', error); toast('Failed to load pending list','danger'); return []; }
  return data || [];
}

async function toggleApprove(id, approve=true){
  const { error } = await supabase.from('profiles').update({ approved: approve }).eq('id', id);
  if(error){ console.error('approve err', error); toast('Failed to update approval','danger'); return false; }
  toast(approve ? 'User approved' : 'Approval revoked','success');
  return true;
}

/* ------------------ Init and form wiring ------------------ */
function initAuthForms(){
  const reg = document.getElementById('registerForm');
  if(reg) reg.addEventListener('submit', handleRegister);

  const login = document.getElementById('loginForm');
  if(login) login.addEventListener('submit', handleLogin);

  // Admin approvals page wiring if present
  const pendingContainer = document.getElementById('pendingApprovals');
  if(pendingContainer){
    (async ()=>{
      pendingContainer.innerHTML = '<em>Loading pending approvals…</em>';
      const list = await fetchPendingApprovals();
      if(!list || !list.length){ pendingContainer.innerHTML = '<div>No pending approvals</div>'; return; }
      pendingContainer.innerHTML = '';
      list.forEach(u=>{
        const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.gap='12px'; row.style.padding='10px 6px'; row.style.borderBottom='1px solid #eee';
        const info = document.createElement('div'); info.innerHTML = `<strong>${u.full_name||u.username||u.email}</strong><br/><small>${u.email || ''} • ${u.role}</small>`;
        const actions = document.createElement('div');
        const approveBtn = document.createElement('button'); approveBtn.textContent = 'Approve'; approveBtn.style.marginRight='6px';
        const rejectBtn = document.createElement('button'); rejectBtn.textContent = 'Reject';
        approveBtn.onclick = async ()=>{ approveBtn.disabled=true; await toggleApprove(u.id,true); location.reload(); };
        rejectBtn.onclick = async ()=>{ rejectBtn.disabled=true; await toggleApprove(u.id,false); location.reload(); };
        actions.appendChild(approveBtn); actions.appendChild(rejectBtn);
        row.appendChild(info); row.appendChild(actions);
        pendingContainer.appendChild(row);
      });
    })();
  }

  makeToastContainer();
}

document.addEventListener('DOMContentLoaded', initAuthForms);
window._vasudha_supabase = { supabase, fetchPendingApprovals, toggleApprove };
