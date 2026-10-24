// js/admin.js — pantalla de inicio de sesión

function mostrarError(mensaje) {
  const errorDiv = document.getElementById("loginError");
  errorDiv.textContent = mensaje;
  errorDiv.classList.add("show");
}

function limpiarError() {
  const errorDiv = document.getElementById("loginError");
  errorDiv.classList.remove("show");
  errorDiv.textContent = "";
}

function setCargando(cargando) {
  const btn = document.getElementById("btnEntrar");
  if (!btn) return;
  btn.disabled = cargando;
  btn.innerHTML = cargando
    ? '<i class="fa-solid fa-spinner fa-spin"></i> Entrando…'
    : 'Entrar <i class="fa-solid fa-arrow-right"></i>';
}

// Lleva a cada quien a su pantalla. Devuelve false si no tiene puesto válido.
async function redirigirSegunRol(userId) {
  const { data: roleRow, error: roleError } = await supabaseClient
    .from("user_roles")
    .select("role, is_superadmin")
    .eq("user_id", userId)
    .single();

  if (roleError || !roleRow) {
    mostrarError("Tu usuario no tiene un puesto asignado. Pide ayuda al administrador.");
    await supabaseClient.auth.signOut();
    return false;
  }

  const rol = roleRow.role;
  if (rol === "admin" || rol === "superadmin" || roleRow.is_superadmin) {
    window.location.replace("dashboard.html");
  } else if (rol === "repartidor") {
    window.location.replace("repartidor.html");
  } else if (rol === "mesero") {
    window.location.replace("mesero.html");
  } else {
    mostrarError("Tu puesto no es válido. Pide ayuda al administrador.");
    await supabaseClient.auth.signOut();
    return false;
  }
  return true;
}

async function login() {
  limpiarError();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) {
    mostrarError("Escribe tu correo y tu contraseña.");
    return;
  }

  const emailRegex = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/;
  if (!emailRegex.test(email)) {
    mostrarError("El correo no está bien escrito. Revisa que tenga @ y un punto.");
    return;
  }

  setCargando(true);
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      switch (error.message) {
        case "Invalid login credentials":
          mostrarError("El correo o la contraseña no son correctos. Inténtalo de nuevo.");
          break;
        case "Email not confirmed":
          mostrarError("Tu correo aún no está confirmado. Pide ayuda al administrador.");
          break;
        default:
          mostrarError(`No se pudo entrar: ${error.message}`);
      }
      return;
    }

    if (!data.user) {
      mostrarError("No se pudo obtener tu información. Inténtalo de nuevo.");
      return;
    }

    await redirigirSegunRol(data.user.id);
  } catch (err) {
    console.error("Error inesperado:", err);
    mostrarError("No hay conexión. Revisa tu internet e inténtalo de nuevo.");
  } finally {
    setCargando(false);
  }
}

document.getElementById("loginForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  login();
});

document.getElementById("togglePassword")?.addEventListener("click", () => {
  const input = document.getElementById("password");
  const btn = document.getElementById("togglePassword");
  const mostrar = input.type === "password";
  input.type = mostrar ? "text" : "password";
  btn.innerHTML = mostrar
    ? '<i class="fa-regular fa-eye-slash"></i> Ocultar'
    : '<i class="fa-regular fa-eye"></i> Ver';
});

document.getElementById("email")?.addEventListener("input", limpiarError);
document.getElementById("password")?.addEventListener("input", limpiarError);

// Si ya hay una sesión abierta (por ejemplo, al abrir la app instalada), entrar directo
(async function entrarSiHaySesion() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    if (!data?.session) return;
    setCargando(true);
    const ok = await redirigirSegunRol(data.session.user.id);
    if (!ok) setCargando(false);
  } catch (err) {
    setCargando(false);
  }
})();
