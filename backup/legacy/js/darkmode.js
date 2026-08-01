/**
 * SUPERMERCADO CASA MOTA — DARK MODE
 * Sistema de tema oscuro con persistencia
 */

// Inicializar Dark Mode al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
});

// Inicializar el tema guardado
function initDarkMode() {
  const savedTheme = localStorage.getItem('casamota_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Si hay tema guardado, usarlo; si no, usar preferencia del sistema
  const isDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
  
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = true;
  }
  
  console.log(`🌓 Tema inicial: ${isDark ? 'Oscuro' : 'Claro'}`);
}

// Toggle Dark Mode
function toggleDarkMode() {
  const toggle = document.getElementById('darkModeToggle');
  const isDark = toggle.checked;
  
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('casamota_theme', 'dark');
    showToast('Tema oscuro activado 🌙', 'success');
    console.log('🌙 Tema oscuro activado');
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('casamota_theme', 'light');
    showToast('Tema claro activado ☀️', 'success');
    console.log('☀️ Tema claro activado');
  }
}

// Listener para cambios en la preferencia del sistema
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  const savedTheme = localStorage.getItem('casamota_theme');
  
  // Solo aplicar si no hay preferencia guardada
  if (!savedTheme) {
    if (e.matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
      const toggle = document.getElementById('darkModeToggle');
      if (toggle) toggle.checked = true;
    } else {
      document.documentElement.removeAttribute('data-theme');
      const toggle = document.getElementById('darkModeToggle');
      if (toggle) toggle.checked = false;
    }
  }
});
