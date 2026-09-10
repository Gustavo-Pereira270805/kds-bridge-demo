(function () {
  'use strict';

  var TOKEN_KEY = 'kds_token';
  var TOKEN_SESSION_KEY = 'kds_token_session';

  // Kiosks (salao/cozinha) usam localStorage: a sessão só termina quando o
  // dispositivo é desligado/ligado (ou o navegador limpa os dados).
  // Gerente/admin usam sessionStorage: fechar a página encerra a sessão,
  // mas recarregar (F5) mantém o login.
  function useSessionStorage(role) {
    return role === 'gerente' || role === 'admin';
  }

  function getToken() {
    try {
      return window.sessionStorage.getItem(TOKEN_SESSION_KEY)
        || window.localStorage.getItem(TOKEN_KEY)
        || '';
    } catch (e) {
      try { return window.localStorage.getItem(TOKEN_KEY) || ''; }
      catch (e2) { return ''; }
    }
  }

  function setToken(token, role) {
    try {
      if (useSessionStorage(role)) {
        window.sessionStorage.setItem(TOKEN_SESSION_KEY, token);
        window.localStorage.removeItem(TOKEN_KEY);
      } else {
        window.localStorage.setItem(TOKEN_KEY, token);
        window.sessionStorage.removeItem(TOKEN_SESSION_KEY);
      }
      // Espelho em cookie: a navegação do navegador (GET da página) não
      // carrega cabeçalho Authorization, então o servidor lê este cookie
      // SÓ no guarda das views da cozinha. A API continua exigindo header
      // (sem fallback de cookie — evita CSRF via navegador).
      document.cookie = 'kds_token=' + encodeURIComponent(token) + '; path=/; SameSite=Lax';
    } catch (e) { /* armazenamento indisponível */ }
  }

  function clearToken() {
    try {
      window.sessionStorage.removeItem(TOKEN_SESSION_KEY);
      window.localStorage.removeItem(TOKEN_KEY);
      document.cookie = 'kds_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    } catch (e) { /* armazenamento indisponível */ }
  }

  window.kdsToken = getToken();
  window.kdsSetToken = setToken;
  window.kdsClearToken = clearToken;

  window.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  window.escAttr = window.esc;

  function loginUrl() {
    var next = window.location.pathname + window.location.search;
    return '/login?next=' + encodeURIComponent(next);
  }

  window.kdsGuard = function () {
    if (!getToken()) {
      window.location.href = loginUrl();
      return false;
    }
    return true;
  };

  window.kdsLogout = function () {
    clearToken();
    if (window.location.pathname !== '/login') {
      window.location.href = loginUrl();
    }
  };

  var originalFetch = window.fetch;
  window.fetch = function (url, opts) {
    opts = opts || {};
    var headers = opts.headers instanceof Headers
      ? opts.headers
      : new Headers(opts.headers || {});
    var token = getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }
    opts.headers = headers;
    return originalFetch(url, opts).then(function (res) {
      if (res.status === 401 && String(url).indexOf('/auth/login') === -1) {
        clearToken();
      }
      return res;
    });
  };

  window.kdsSocket = function (io, opts) {
    opts = opts || {};
    var auth = opts.auth || {};
    auth.token = getToken();
    opts.auth = auth;
    return io('/', opts);
  };
})();
