import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config.js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', async ()=>{
  try{
    const { data } = await supabase.auth.getSession();
    const session = data?.session || null;
    if(!session){
      // not logged in
      if(window.location.pathname !== '/login.html' && window.location.pathname !== '/register.html'){
        window.location.href = '/login.html';
      }
      return;
    }
    // logged in: check profile role for pages that set data-role on body
    const roleNeeded = document.body?.dataset?.role || null;
    if(roleNeeded){
      const { data: profile, error } = await supabase.from('profiles').select('role,approved').eq('id', session.user.id).single();
      if(error || !profile || profile.approved === false || profile.role !== roleNeeded){
        // redirect to login or buyer home
        window.location.href = '/login.html';
      }
    }
  }catch(err){
    console.error('guard error', err);
    window.location.href = '/login.html';
  }
});
