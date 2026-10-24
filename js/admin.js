+// js/admin.js

function mostrarError(mensaje) {
  const errorDiv = document.getElementById("loginError");
  errorDiv.textContent = mensaje;
  errorDiv.classList.add("show");
  setTimeout(() => {
    errorDiv.classList.remove("show");
  }, 5000);
}

function limpiarError() {
  const errorDiv = document.getElementById("loginError");
  errorDiv.classList.remove("show");
  errorDiv.textContent = "";
}

async function login() {
  limpiarError();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!email || !password) {
    mostrarError("❌ Por favor, ingresa tu correo y contraseña.");
    return;
  }

  // Validación básica de formato de email
  const emailRegex = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/;
  if (!emailRegex.test(email)) {
    mostrarError("📧 El correo electrónico no tiene un formato válido.");
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      switch (error.message) {
        case "Invalid login credentials":
          mostrarError("🔐 Correo o contraseña incorrectos. Verifica tus datos.");
          break;
        case "Email not confirmed":
          mostrarError("📬 Tu correo aún no ha sido confirmado. Revisa tu bandeja de entrada.");
          break;
        case "User not found":
          mostrarError("👤 No existe una cuenta con ese correo electrónico.");
          break;
        case "Password should be at least 6 characters":
          mostrarError("🔒 La contraseña debe tener al menos 6 caracteres.");
          break;
        default:
          mostrarError(`⚠️ Error al iniciar sesión: ${error.message}`);
      }
      return;
    }

    if (!data.user) {
      mostrarError("⚠️ No se pudo obtener la información del usuario.");
      return;
    }

    const userId = data.user.id;

    // Verificar rol
    const { data: roleRow, error: roleError } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .single();

    if (roleError || !roleRow) {
      mostrarError("🚫 Tu usuario no tiene un rol asignado. Contacta al administrador.");
      await supabaseClient.auth.signOut();
      return;
    }

    const rol = roleRow.role;

    // Redirigir según el rol
    if (rol === "admin" || rol === "superadmin") {
      window.location.href = "dashboard.html";
    } else if (rol === "repartidor") {
      window.location.href = "repartidor.html";
    } else if (rol === "mesero") {
      window.location.href = "mesero.html";
    } else {
      mostrarError("❓ Rol de usuario no válido. Contacta al administrador.");
      await supabaseClient.auth.signOut();
    }

  } catch (err) {
    console.error("Error inesperado:", err);
    mostrarError("🌐 Error de conexión. Intenta de nuevo más tarde.");
  }
}

// Limpiar error cuando el usuario empieza a escribir
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
if (emailInput) emailInput.addEventListener("input", limpiarError);
if (passwordInput) passwordInput.addEventListener("input", limpiarError);