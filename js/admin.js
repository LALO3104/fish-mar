async function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!email || !password) {
    alert("Escribe tu correo y contraseña.");
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error(error);
    alert("No se pudo iniciar sesión.");
    return;
  }

  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !userData?.user) {
    alert("No se pudo leer el usuario autenticado.");
    return;
  }

  const userId = userData.user.id;

  const { data: roleRow, error: roleError } = await supabaseClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();

  if (roleError || !roleRow) {
    console.error(roleError);
    alert("Tu usuario no tiene rol asignado.");
    await supabaseClient.auth.signOut();
    return;
  }

  if (roleRow.role === "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  if (roleRow.role === "repartidor") {
    window.location.href = "repartidor.html";
    return;
  }

  alert("Rol no válido.");
  await supabaseClient.auth.signOut();
}