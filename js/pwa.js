// js/pwa.js — instalar FishMar como app en el celular del personal
// - Registra el service worker (necesario para poder instalar).
// - Muestra un aviso "Instalar FishMar en este celular".
//   · Android/Chrome: abre la ventana de instalación del sistema.
//   · iPhone: explica los pasos (Compartir → Agregar a inicio).
// - Avisa cuando se pierde el internet.

(function () {
  const CLAVE_OCULTO = "fishmar_instalar_oculto";
  let avisoInstalacion = null;   // evento de Chrome para instalar

  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const yaInstalada = () =>
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  function leerOculto() {
    try { return localStorage.getItem(CLAVE_OCULTO) === "1"; } catch (e) { return false; }
  }
  function guardarOculto() {
    try { localStorage.setItem(CLAVE_OCULTO, "1"); } catch (e) { /* sin almacenamiento */ }
  }

  // ---------- Aviso de instalación ----------
  function mostrarAviso() {
    if (yaInstalada() || document.getElementById("avisoInstalar")) return;
    const enLogin = document.getElementById("pwaSlot");
    // En el inicio de sesión siempre se ofrece; en las demás pantallas se puede ocultar
    if (!enLogin && leerOculto()) return;

    const aviso = document.createElement("div");
    aviso.id = "avisoInstalar";
    aviso.className = "install-banner";
    aviso.innerHTML = `
      <img src="icons/icon-192.png" alt="" width="44" height="44">
      <div class="grow">
        <strong>Instala FishMar en tu celular</strong>
        <span>Ábrela con un toque, como cualquier app.</span>
      </div>
      <button class="btn btn-primary btn-sm" type="button" id="btnInstalar">Instalar</button>
      ${enLogin ? "" : '<button class="install-close" type="button" id="btnCerrarInstalar" aria-label="Ahora no">&times;</button>'}`;

    if (enLogin) {
      enLogin.appendChild(aviso);
    } else {
      const page = document.querySelector("main.page");
      if (!page) return;
      page.prepend(aviso);
    }

    document.getElementById("btnInstalar").addEventListener("click", instalar);
    document.getElementById("btnCerrarInstalar")?.addEventListener("click", () => {
      guardarOculto();
      aviso.remove();
    });
  }

  async function instalar() {
    if (avisoInstalacion) {
      avisoInstalacion.prompt();
      const { outcome } = await avisoInstalacion.userChoice;
      avisoInstalacion = null;
      if (outcome === "accepted") document.getElementById("avisoInstalar")?.remove();
      return;
    }
    if (esIOS) {
      mostrarPasosIOS();
      return;
    }
    mostrarPasosOtros();
  }

  // ---------- Pasos para iPhone ----------
  function hoja(id, titulo, cuerpo) {
    let modal = document.getElementById(id);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = id;
      modal.className = "modal";
      modal.innerHTML = `
        <div class="sheet">
          <div class="sheet-header">
            <h3 class="sheet-title">${titulo}</h3>
            <button class="sheet-close" type="button" aria-label="Cerrar">&times;</button>
          </div>
          <div class="sheet-body">${cuerpo}</div>
          <div class="sheet-footer">
            <button class="btn btn-primary btn-lg btn-block" type="button">Entendido</button>
          </div>
        </div>`;
      const cerrar = () => { modal.style.display = "none"; document.body.classList.remove("no-scroll"); };
      modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(); });
      modal.querySelector(".sheet-close").addEventListener("click", cerrar);
      modal.querySelector(".sheet-footer .btn").addEventListener("click", cerrar);
      document.body.appendChild(modal);
    }
    modal.style.display = "block";
    document.body.classList.add("no-scroll");
  }

  function mostrarPasosIOS() {
    hoja("pasosIOS", "Instalar en iPhone", `
      <p class="muted">Abre esta página en <strong>Safari</strong> y sigue estos pasos:</p>
      <ol class="install-steps">
        <li><span class="step-icon"><i class="fa-solid fa-arrow-up-from-bracket"></i></span>
            Toca el botón <strong>Compartir</strong>, abajo en el centro de la pantalla.</li>
        <li><span class="step-icon"><i class="fa-regular fa-square-plus"></i></span>
            Baja y toca <strong>"Agregar a inicio"</strong>.</li>
        <li><span class="step-icon"><i class="fa-solid fa-check"></i></span>
            Toca <strong>"Agregar"</strong>, arriba a la derecha.</li>
      </ol>
      <p class="muted small">Listo: aparecerá el ícono de FishMar en tu pantalla de inicio.</p>`);
  }

  function mostrarPasosOtros() {
    hoja("pasosOtros", "Instalar FishMar", `
      <ol class="install-steps">
        <li><span class="step-icon"><i class="fa-solid fa-ellipsis-vertical"></i></span>
            Toca el menú <strong>⋮</strong> de tu navegador (arriba a la derecha).</li>
        <li><span class="step-icon"><i class="fa-solid fa-mobile-screen"></i></span>
            Toca <strong>"Instalar app"</strong> o <strong>"Agregar a la pantalla de inicio"</strong>.</li>
      </ol>
      <p class="muted small">Si no aparece, abre esta página en <strong>Google Chrome</strong>.</p>`);
  }

  // ---------- Eventos del navegador ----------
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    avisoInstalacion = e;
    mostrarAviso();
  });

  window.addEventListener("appinstalled", () => {
    document.getElementById("avisoInstalar")?.remove();
    if (typeof showToast === "function") showToast("¡Listo! FishMar quedó instalada en tu celular.", "success");
  });

  // Aviso de conexión
  window.addEventListener("offline", () => {
    if (typeof showToast === "function") showToast("Sin internet. Los cambios no se guardarán hasta que vuelva la conexión.");
  });
  window.addEventListener("online", () => {
    if (typeof showToast === "function") showToast("Conexión recuperada", "success");
  });

  // iPhone no tiene evento de instalación: ofrecer los pasos directamente
  document.addEventListener("DOMContentLoaded", () => {
    if (esIOS && !yaInstalada()) mostrarAviso();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("No se pudo registrar el service worker:", err));
    });
  }
})();
