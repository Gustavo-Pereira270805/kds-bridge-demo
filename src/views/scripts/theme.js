(function () {
  var STORAGE_KEY = 'kds-theme';
  var THEMES = ['dark', 'light'];

  function getCurrent() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  function apply(theme) {
    if (THEMES.indexOf(theme) === -1) theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    document.dispatchEvent(new CustomEvent('kds-theme-change', { detail: { theme: theme } }));
    return theme;
  }

  function toggle() {
    return apply(getCurrent() === 'dark' ? 'light' : 'dark');
  }

  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    var t = e.newValue || 'dark';
    if (THEMES.indexOf(t) === -1) t = 'dark';
    document.documentElement.setAttribute('data-theme', t);
    document.dispatchEvent(new CustomEvent('kds-theme-change', { detail: { theme: t } }));
  });

  window.KDSTheme = { apply: apply, toggle: toggle, getCurrent: getCurrent, THEMES: THEMES };
})();
