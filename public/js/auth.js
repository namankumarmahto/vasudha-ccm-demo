import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Toast UI
function toast(msg, type = "info") {
  alert(msg); // (Simple fallback toast)
}

// REGISTER
export async function handleRegisterForm(e) {
  e.preventDefault();
  const form = e.target;

  const first = form.querySelector("#first").value.trim();
  const email = form.querySelector("#email").value.trim();
  const password = form.querySelector("#password1").value.trim();
  const username = form.querySelector("#usernameReg").value.trim();
  const phone = form.querySelector("#phone").value.trim();
  const role = form.querySelector("#accountType").value.trim();

  if (!first || !email || !password) {
    toast("Fill required fields", "danger");
    return;
  }

  // 1. Create Supabase User
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email,
    password,
  });

  if (signUpErr) {
    toast(signUpErr.message, "danger");
    return;
  }

  const userId = signUpData.user?.id;

  // 2. Insert Profile
  const { error: profileErr } = await supabase.from("profiles").insert([
    {
      id: userId,
      full_name: first,
      username,
      email,
      phone,
      role,
      approved: true,
    },
  ]);

  if (profileErr) {
    toast("Profile save issue", "danger");
    return;
  }

  toast("Registration successful! Please login.", "success");
  window.location.href = "/login.html";
}

// LOGIN
export async function handleLoginForm(e) {
  e.preventDefault();
  const form = e.target;

  const email = form.querySelector("#username").value.trim();
  const password = form.querySelector("#password").value.trim();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    toast("Invalid email or password", "danger");
    return;
  }

  const user = data.user;

  // Check profile exists
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (pErr || !profile) {
    toast("Account not registered", "danger");
    await supabase.auth.signOut();
    return;
  }

  // Redirect based on role
  if (profile.role === "admin") window.location.href = "/admin/index.html";
  else if (profile.role === "verifier") window.location.href = "/verifier.html";
  else if (profile.role === "field_user") window.location.href = "/field-user.html";
  else window.location.href = "/buyer.html";
}

// Form wiring
document.addEventListener("DOMContentLoaded", () => {
  const reg = document.getElementById("registerForm");
  if (reg) reg.addEventListener("submit", handleRegisterForm);

  const login = document.getElementById("loginForm");
  if (login) login.addEventListener("submit", handleLoginForm);
});

window.supabase = supabase;
