import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Protect page
document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login.html";
    return;
  }

  // Check correct role
  const roleNeeded = document.body.dataset.role;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.session.user.id)
    .single();

  if (!profile || profile.role !== roleNeeded) {
    window.location.href = "/login.html";
  }
});
