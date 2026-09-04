/* gerente-nav.js — menu lateral colapsável de navegação entre telas.
 * Visível SOMENTE para os papéis "gerente" e "admin" (verificado via GET /api/v1/auth/me).
 * Incluído nas telas: salão, cozinha quente, cozinha fria e gerente.
 */
(function () {
  'use strict';

  // Ícones 2D minimalistas: apenas outline, linhas arredondadas, mesma cor do rótulo (currentColor).
  var ICONS = {
    // Salão: cloche (tampa de prato)
    salao: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18"/><path d="M12 6a8 8 0 0 1 8 8H4a8 8 0 0 1 8-8Z"/><path d="M12 6V4.5"/><circle cx="12" cy="3.4" r="1"/></svg>',
    // Cozinha quente: fogo (chama)
    quente: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    // Cozinha fria: folha (alface)
    fria: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>',
    // Gerente: lápis (gestão/edição)
    gerente: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>'
  };

  var ITEMS = [
    { href: '/salao', label: 'Salão', icon: 'salao' },
    { href: '/cozinha-quente', label: 'Cozinha Quente', icon: 'quente' },
    { href: '/cozinha-fria', label: 'Cozinha Fria', icon: 'fria' },
    { href: '/gerente', label: 'Gerente', icon: 'gerente' }
  ];

  var STORAGE_KEY = 'kds-gerente-nav';

  function currentPath() {
    var p = String(window.location.pathname || '/').replace(/\/$/, '');
    return p === '' ? '/' : p;
  }

  function isCollapsedDefault() {
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'collapsed') return true;
      if (saved === 'expanded') return false;
    } catch (e) { /* armazenamento indisponível */ }
    return window.innerWidth <= 768;
  }

  function applyCollapsed(nav, collapsed) {
    if (collapsed) {
      nav.classList.add('collapsed');
      document.body.classList.add('gnav-collapsed');
    } else {
      nav.classList.remove('collapsed');
      document.body.classList.remove('gnav-collapsed');
    }
    var toggle = document.getElementById('gnavToggle');
    if (toggle) {
      toggle.setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
      toggle.setAttribute('title', collapsed ? 'Expandir' : 'Recolher');
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
    } catch (e) { /* armazenamento indisponível */ }
  }

  function build() {
    if (document.getElementById('gerenteNav')) return;
    var path = currentPath();
    var html = '<button type="button" class="gnav-toggle" id="gnavToggle" aria-label="Recolher menu" title="Recolher">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 7-5 5 5 5"/><path d="m18 7-5 5 5 5"/></svg>' +
      '<span class="gnav-label">Menu</span></button>';
    ITEMS.forEach(function (item) {
      var active = path === item.href;
      html += '<a class="gnav-link' + (active ? ' active' : '') + '"' +
        ' href="' + item.href + '"' +
        ' title="' + item.label + '"' +
        (active ? ' aria-current="page"' : '') + '>' +
        ICONS[item.icon] + '<span class="gnav-label">' + item.label + '</span></a>';
    });
    var nav = document.createElement('nav');
    nav.id = 'gerenteNav';
    nav.setAttribute('aria-label', 'Navegação do gerente');
    nav.innerHTML = html;
    document.body.insertBefore(nav, document.body.firstChild);
    document.body.classList.add('has-gerente-nav');
    applyCollapsed(nav, isCollapsedDefault());
    var toggle = document.getElementById('gnavToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        applyCollapsed(nav, !nav.classList.contains('collapsed'));
      });
    }
  }

  function init() {
    // Somente gerente/admin: qualquer outro papel (ou sem login) não vê o menu.
    window.fetch('/api/v1/auth/me', { headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) return null;
      return res.json().catch(function () { return null; });
    }).then(function (data) {
      var role = data && data.user ? data.user.role : null;
      if (role === 'gerente' || role === 'admin') build();
    }).catch(function () { /* sem menu fora dos papéis de gestão */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
