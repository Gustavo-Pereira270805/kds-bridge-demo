(function () {
  function normalizeTheme(theme) {
    return theme === 'light' ? 'light' : 'dark';
  }

  function apply(theme) {
    var normalized = normalizeTheme(theme);
    document.documentElement.setAttribute('data-theme', normalized);
    return normalized;
  }

  function load(stationCode) {
    return fetch('/api/v1/station-themes/' + encodeURIComponent(stationCode))
      .then(function (response) {
        if (!response.ok) throw new Error('Falha ao carregar tema da estação');
        return response.json();
      })
      .then(function (payload) { return apply(payload.theme); })
      .catch(function () { return apply('dark'); });
  }

  function watch(socket, stationCode) {
    if (!socket || typeof socket.on !== 'function') return;
    socket.on('station:theme-updated', function (payload) {
      if (payload && payload.stationCode === stationCode) apply(payload.theme);
    });
  }

  window.KDSStationTheme = { apply: apply, load: load, watch: watch };
})();
