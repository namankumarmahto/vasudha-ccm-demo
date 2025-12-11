/*
  public/js/guard.js
  Protects all pages. Blocks access unless:
  - user is logged in
  - user profile exists in DB
  - user role matches the page requirement (optional)
*/

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function protectPage() {
  // 1️⃣ CHECK SESSION
  const { data } = await supabase.auth.getSession();
  const session = data?.session;

  if (!session) {
    alert("You must log in before accessing this page.");
    window.location.href = "/login.html";
    return;
  }

  const user = session.user;

  // 2️⃣ CHECK PROFILE EXISTS
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, approved")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    await supabase.auth.signOut();
    alert("Your account is not registered. Please register first.");
    window.location.href = "/user-register.html";
    return;
  }

  // Optional: if you want admin approval
  if (profile.approved === false) {
    await supabase.auth.signOut();
    alert("Your account is not approved yet.");
    window.location.href = "/login.html";
    return;
  }

  // 3️⃣ ROLE CHECK
  const requiredRole = document.body.dataset.role;

  if (requiredRole && profile.role !== requiredRole) {
    alert("You do not have permission to view this page.");
    window.location.href = "/login.html";
    return;
  }

  console.log("ACCESS GRANTED →", profile.role);
}

// Run protection when page loads
protectPage();
