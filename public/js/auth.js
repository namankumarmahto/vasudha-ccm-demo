export async function handleRegisterForm(e){
  e.preventDefault();

  const form = e.target;

  const first      = form.querySelector("#first").value.trim();
  const last       = form.querySelector("#last").value.trim();
  const email      = form.querySelector("#email").value.trim();
  const password   = form.querySelector("#password1").value.trim();
  const username   = form.querySelector("#usernameReg").value.trim();
  const phone      = form.querySelector("#phone").value.trim();
  const role       = form.querySelector("#accountType").value.trim();
  const agree      = form.querySelector("#agree").checked;

  if (!first || !email || !password) {
    toast("Please fill required fields.", "danger");
    return;
  }

  if (!agree) {
    toast("You must accept Terms & Conditions.", "danger");
    return;
  }

  // ===============================
  // 1️⃣ Register user in Supabase
  // ===============================
  const { data: signupData, error: signupErr } =
    await supabase.auth.signUp({ email, password });

  if (signupErr) {
    toast(signupErr.message, "danger");
    return;
  }

  const userId = signupData.user?.id;

  // =======================================
  // 2️⃣ Insert profile data in the database
  // =======================================
  const full_name = `${first} ${last}`.trim();

  const { error: profileErr } = await supabase.from("profiles").insert([
    {
      id: userId,
      full_name,
      username: username || null,
      email,
      phone: phone || null,
      role,
      approved: true
    }
  ]);

  if (profileErr) {
    toast("Failed to save profile. Contact admin.", "danger");
    console.error(profileErr);
    return;
  }

  toast("Registration successful! Redirecting to login…", "success");

  setTimeout(() => {
    window.location.href = "/login.html";
  }, 1500);
}
