(function () {
  'use strict';

  // Motor de sons do salão — Web Audio API nativa (sem Tone.js, sem CDN).
  // Mesmo motor de `kitchen-sounds.js`: AudioContext preguiçoso, master com
  // compressor, alerta pendente com retry (autoplay) e desbloqueio por gesto.
  // ES5 — sem let/const/arrow/template literals.

  var audio = null;
  var master = null;
  var pendingAlert = null;
  var retryTimer = null;
  var retryIndex = 0;
  var RETRY_DELAYS = [1000, 2000, 3000];

  function getContext() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio API indisponível neste navegador');
    if (!audio) {
      audio = new Ctx();
      master = audio.createGain();
      var compressor = audio.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 6;
      master.connect(compressor);
      compressor.connect(audio.destination);
    }
    return audio;
  }

  function resumeContext() {
    if (!audio || audio.state !== 'suspended' || typeof audio.resume !== 'function') return;
    try {
      var p = audio.resume();
      if (p && typeof p.catch === 'function') {
        p.catch(function (e) { console.error('KDS sons (salão): falha ao retomar o áudio:', e); });
      }
    } catch (e) {
      console.error('KDS sons (salão): falha ao retomar o áudio:', e);
    }
  }

  function clearRetryTimer() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }

  function flushPending() {
    if (!pendingAlert) return;
    if (!audio || audio.state !== 'running') return;
    var fn = pendingAlert;
    pendingAlert = null;
    retryIndex = 0;
    clearRetryTimer();
    try {
      fn();
    } catch (e) {
      console.error('KDS sons (salão): falha ao tocar alerta pendente:', e);
    }
  }

  function scheduleRetry(recipe) {
    pendingAlert = recipe;
    clearRetryTimer();
    if (retryIndex >= RETRY_DELAYS.length) {
      console.error('KDS sons (salão): navegador bloqueou o áudio (autoplay); o alerta tocará no primeiro toque na tela.');
      return;
    }
    var delay = RETRY_DELAYS[retryIndex];
    retryIndex++;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (audio && audio.state === 'running') {
        flushPending();
      } else if (pendingAlert) {
        scheduleRetry(pendingAlert);
      }
    }, delay);
  }

  function unlock() {
    resumeContext();
    flushPending();
  }

  function bindGestureUnlock() {
    var events = ['click', 'touchstart', 'keydown'];
    for (var i = 0; i < events.length; i++) {
      document.addEventListener(events[i], unlock);
    }
    // Guia em background fica com o AudioContext suspenso (política do navegador):
    // ao voltar a ficar visível, retomar o contexto e tocar o alerta pendente.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) unlock();
    });
  }

  function play(recipe, name) {
    try {
      var ctx = getContext();
      if (ctx.state === 'suspended') {
        resumeContext();
        scheduleRetry(recipe);
        return;
      }
      clearRetryTimer();
      pendingAlert = null;
      retryIndex = 0;
      recipe();
    } catch (e) {
      console.error('KDS sons (salão): falha ao tocar alerta "' + name + '":', e);
    }
  }

  // Envelope exponencial por vozes: silêncio -> pico em `attack` -> silêncio em `duration`.
  function gainEnvelope(at, attack, peak, duration) {
    var gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    return gain;
  }

  // Sino de mesa (call bell): parciais inarmônicos brilhantes, ataque rápido
  // e decay longo — o "DING" metálico de balcão de restaurante.
  var DESKBELL_PROFILE = [[1, 1, 1], [2.4, 0.45, 0.5], [3.9, 0.28, 0.35], [5.13, 0.15, 0.25], [6.79, 0.08, 0.18]];

  function deskBell(freq, at, duration, volume) {
    for (var i = 0; i < DESKBELL_PROFILE.length; i++) {
      var p = DESKBELL_PROFILE[i];
      var partialDuration = duration * p[2];
      var osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * p[0];
      osc.connect(gainEnvelope(at, 0.002, volume * p[1], partialDuration)).connect(master);
      osc.start(at);
      osc.stop(at + partialDuration + 0.05);
    }
  }

  // ---- Receitas ----

  // Pronto para retirada: DING-DING — duas batidas iguais do sino de mesa.
  function recipeReady() {
    var at = audio.currentTime;
    deskBell(1760, at, 1.4, 0.7);
    deskBell(1760, at + 0.3, 1.4, 0.7);
  }

  window.playReadyAlert = function () { play(recipeReady, 'pronto para retirada'); };

  bindGestureUnlock();
})();
