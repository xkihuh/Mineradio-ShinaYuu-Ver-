(function () {
  'use strict';

  var originalPlayQueueAt = window.playQueueAt;
  var originalTogglePlay = window.togglePlay;
  var originalSetVolume = window.setVolume;
  var originalGetDuration = window.getPlaybackDurationSeconds;
  var originalGetCurrent = window.getPlaybackCurrentSeconds;
  var originalSeekFromPointer = window.seekFromProgressPointer;
  var originalPauseForSwitch = window.pauseCurrentAudioForTrackSwitch;
  var originalSyncFromAudio = window.syncPlaybackStateFromAudioEvent;
  var originalCanReloadForQuality = window.canReloadCurrentTrackForQuality;
  var originalUpdateQualityUi = window.updatePlaybackQualityUi;

  var spotifyDirectState = {
    active: false,
    mode: 'none',
    deviceId: '',
    deviceName: '',
    sdkReady: false,
    sdkError: '',
    currentUri: '',
    currentTrackId: '',
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
    updatedAt: 0,
    clockUpdatedAt: 0,
    endedHandledFor: '',
    pollTimer: null,
    clockSyncTimer: null,
    clockSyncBusy: false,
    volumeTimer: null,
    sdkPlayer: null,
    sdkPromise: null,
    sdkCreatingPromise: null,
    sdkResolve: null,
    sdkReject: null,
    sdkScriptPromise: null,
    prewarmPromise: null,
    audioActivated: false,
    sdkPlaybackError: '',
    sdkStateReceivedAt: 0,
    lastStateWasPlaying: false,
    lastStatePositionMs: 0,
    lastStateDurationMs: 0,
    requestedUri: '',
    playRequestId: '',
    switchingTrack: false,
    lastActualUri: '',
    wrongTrackSince: 0,
    visualLastPositionSec: -1,
    visualPulse: 0,
    seekSerial: 0,
    seeking: false,
    seekTargetMs: 0,
    seekStartedAt: 0
  };

  window.spotifyDirectState = spotifyDirectState;
  window.activePlaybackTransport = window.activePlaybackTransport || 'none';

  // Real-time Spotify visual analysis. Spotify's SDK does not expose PCM to
  // the Electron page, so on Windows we analyse the actual speaker output via
  // Electron's loopback display-media stream. The stream is never recorded,
  // persisted, or sent to any server.
  var spotifyRealtimeAudio = {
    status: 'idle',
    promise: null,
    stream: null,
    ctx: null,
    source: null,
    analyser: null,
    frequency: null,
    timeDomain: null,
    previousSpectrum: null,
    fastLow: 0,
    slowLow: 0,
    fastBody: 0,
    slowBody: 0,
    peakLow: 0.06,
    peakBody: 0.05,
    peakHigh: 0.04,
    peakRms: 0.025,
    previousLow: 0,
    previousRms: 0,
    onsetMean: 0.010,
    onsetDeviation: 0.008,
    noiseFloor: 0.004,
    lastHitAt: -10,
    warmupFrames: 0,
    error: ''
  };
  window.spotifyRealtimeAudio = spotifyRealtimeAudio;

  function realtimeFollow(current, next, dt, attack, release) {
    var tau = next > current ? attack : release;
    return current + (next - current) * (1 - Math.exp(-Math.max(0.001, dt) / Math.max(0.001, tau)));
  }

  function resetSpotifyRealtimeDetector() {
    spotifyRealtimeAudio.fastLow = 0;
    spotifyRealtimeAudio.slowLow = 0;
    spotifyRealtimeAudio.fastBody = 0;
    spotifyRealtimeAudio.slowBody = 0;
    spotifyRealtimeAudio.peakLow = 0.06;
    spotifyRealtimeAudio.peakBody = 0.05;
    spotifyRealtimeAudio.peakHigh = 0.04;
    spotifyRealtimeAudio.peakRms = 0.025;
    spotifyRealtimeAudio.previousLow = 0;
    spotifyRealtimeAudio.previousRms = 0;
    spotifyRealtimeAudio.onsetMean = 0.010;
    spotifyRealtimeAudio.onsetDeviation = 0.008;
    spotifyRealtimeAudio.noiseFloor = 0.004;
    spotifyRealtimeAudio.lastHitAt = -10;
    spotifyRealtimeAudio.warmupFrames = 0;
    if (spotifyRealtimeAudio.previousSpectrum) spotifyRealtimeAudio.previousSpectrum.fill(0);
    spotifyDirectState.visualPulse = 0;
  }

  function stopSpotifyRealtimeCapture() {
    var stream = spotifyRealtimeAudio.stream;
    spotifyRealtimeAudio.stream = null;
    if (stream) {
      try { stream.getTracks().forEach(function (track) { track.stop(); }); } catch (_) {}
    }
    try { if (spotifyRealtimeAudio.source) spotifyRealtimeAudio.source.disconnect(); } catch (_) {}
    spotifyRealtimeAudio.source = null;
    spotifyRealtimeAudio.analyser = null;
    spotifyRealtimeAudio.frequency = null;
    spotifyRealtimeAudio.timeDomain = null;
    spotifyRealtimeAudio.previousSpectrum = null;
    var ctx = spotifyRealtimeAudio.ctx;
    spotifyRealtimeAudio.ctx = null;
    if (ctx && ctx.state !== 'closed') {
      try { ctx.close(); } catch (_) {}
    }
    spotifyRealtimeAudio.promise = null;
    spotifyRealtimeAudio.status = 'idle';
    resetSpotifyRealtimeDetector();
  }
  window.stopSpotifyRealtimeCapture = stopSpotifyRealtimeCapture;

  async function ensureSpotifyRealtimeCapture() {
    if (spotifyRealtimeAudio.status === 'ready' && spotifyRealtimeAudio.stream) {
      if (spotifyRealtimeAudio.ctx && spotifyRealtimeAudio.ctx.state === 'suspended') {
        await spotifyRealtimeAudio.ctx.resume().catch(function () {});
      }
      return true;
    }
    if (spotifyRealtimeAudio.promise) return spotifyRealtimeAudio.promise;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      spotifyRealtimeAudio.status = 'unsupported';
      spotifyRealtimeAudio.error = 'DISPLAY_MEDIA_UNAVAILABLE';
      return false;
    }
    spotifyRealtimeAudio.status = 'requesting';
    spotifyRealtimeAudio.error = '';
    spotifyRealtimeAudio.promise = navigator.mediaDevices.getDisplayMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2
      },
      video: {
        width: { max: 2 },
        height: { max: 2 },
        frameRate: { max: 1 }
      }
    }).then(function (stream) {
      var audioTracks = stream.getAudioTracks();
      stream.getVideoTracks().forEach(function (track) { try { track.stop(); } catch (_) {} });
      if (!audioTracks.length) {
        try { stream.getTracks().forEach(function (track) { track.stop(); }); } catch (_) {}
        throw new Error('SPOTIFY_LOOPBACK_AUDIO_MISSING');
      }
      var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) throw new Error('AUDIO_CONTEXT_UNAVAILABLE');
      var ctx = new AudioContextCtor({ latencyHint: 'interactive' });
      var source = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.04;
      source.connect(analyser);
      spotifyRealtimeAudio.stream = stream;
      spotifyRealtimeAudio.ctx = ctx;
      spotifyRealtimeAudio.source = source;
      spotifyRealtimeAudio.analyser = analyser;
      spotifyRealtimeAudio.frequency = new Uint8Array(analyser.frequencyBinCount);
      spotifyRealtimeAudio.timeDomain = new Uint8Array(analyser.fftSize);
      spotifyRealtimeAudio.previousSpectrum = new Float32Array(analyser.frequencyBinCount);
      spotifyRealtimeAudio.status = 'ready';
      audioTracks[0].addEventListener('ended', function () {
        if (spotifyRealtimeAudio.stream === stream) stopSpotifyRealtimeCapture();
      }, { once: true });
      resetSpotifyRealtimeDetector();
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      console.info('[SpotifyRealtime] Windows loopback analyser ready');
      return true;
    }).catch(function (error) {
      spotifyRealtimeAudio.status = 'error';
      spotifyRealtimeAudio.error = String(error && (error.message || error) || 'SPOTIFY_REALTIME_CAPTURE_FAILED');
      console.warn('[SpotifyRealtime]', spotifyRealtimeAudio.error);
      return false;
    }).finally(function () {
      spotifyRealtimeAudio.promise = null;
    });
    return spotifyRealtimeAudio.promise;
  }
  window.ensureSpotifyRealtimeCapture = ensureSpotifyRealtimeCapture;

  function spotifyRealtimeBandRms(data, sampleRate, fftSize, hz0, hz1) {
    if (!data || !data.length) return 0;
    var binHz = sampleRate / fftSize;
    var start = Math.max(1, Math.floor(hz0 / binHz));
    var end = Math.min(data.length - 1, Math.ceil(hz1 / binHz));
    var sum = 0;
    var count = 0;
    for (var i = start; i <= end; i++) {
      var value = data[i] / 255;
      sum += value * value;
      count++;
    }
    return count ? Math.sqrt(sum / count) : 0;
  }

  function triggerSpotifyRealtimeBeat(positionSec, strength, confidence, lowNorm, bodyNorm, highNorm) {
    spotifyDirectState.visualPulse = Math.max(spotifyDirectState.visualPulse, strength);
    window.beatPulse = Math.max(Number(window.beatPulse) || 0, strength * 0.86);
    window.beatOnsetFlag = true;
    window.smoothBass = Math.max(Number(window.smoothBass) || 0, 0.18 + lowNorm * 0.62);
    window.smoothMid = Math.max(Number(window.smoothMid) || 0, 0.10 + bodyNorm * 0.34);
    window.smoothTreb = Math.max(Number(window.smoothTreb) || 0, 0.06 + highNorm * 0.24);
    window.smoothEnergy = Math.max(Number(window.smoothEnergy) || 0, 0.18 + strength * 0.52);
    if (typeof window.scheduleBeatCamera === 'function') {
      window.scheduleBeatCamera({
        time: positionSec,
        strength: strength,
        confidence: confidence,
        low: lowNorm,
        body: bodyNorm,
        snap: highNorm,
        mass: Math.min(1, lowNorm * 0.84 + bodyNorm * 0.16),
        sharpness: Math.min(1, highNorm * 0.46 + confidence * 0.20),
        combo: strength > 0.82 ? 'accent' : 'push',
        impact: strength,
        primary: true
      }, 'live');
    }
    if (strength > 0.72 && typeof window.triggerRipple === 'function') {
      try { window.triggerRipple(0, 0, Math.min(0.82, 0.28 + strength * 0.42)); } catch (_) {}
    }
  }

  function processSpotifyRealtimeFrame(dt) {
    var state = spotifyRealtimeAudio;
    if (state.status !== 'ready' || !state.analyser || !state.ctx || !state.frequency || !state.timeDomain) return false;
    if (state.ctx.state === 'suspended') state.ctx.resume().catch(function () {});
    dt = Math.max(0.001, Math.min(0.080, Number(dt) || 0.016));
    state.analyser.getByteFrequencyData(state.frequency);
    state.analyser.getByteTimeDomainData(state.timeDomain);
    var sampleRate = state.ctx.sampleRate || 48000;
    var fftSize = state.analyser.fftSize;
    var sub = spotifyRealtimeBandRms(state.frequency, sampleRate, fftSize, 34, 78);
    var kick = spotifyRealtimeBandRms(state.frequency, sampleRate, fftSize, 52, 185);
    var body = spotifyRealtimeBandRms(state.frequency, sampleRate, fftSize, 185, 650);
    var mid = spotifyRealtimeBandRms(state.frequency, sampleRate, fftSize, 650, 3200);
    var high = spotifyRealtimeBandRms(state.frequency, sampleRate, fftSize, 3200, 12000);
    var low = Math.min(1, kick * 0.84 + sub * 0.42);
    var rms = 0;
    for (var i = 0; i < state.timeDomain.length; i++) {
      var sample = (state.timeDomain[i] - 128) / 128;
      rms += sample * sample;
    }
    rms = Math.sqrt(rms / Math.max(1, state.timeDomain.length));

    var lowFlux = Math.max(0, low - state.previousLow);
    var rmsFlux = Math.max(0, rms - state.previousRms);
    var spectrumFlux = 0;
    var fluxCount = 0;
    var binHz = sampleRate / fftSize;
    var fluxStart = Math.max(1, Math.floor(38 / binHz));
    var fluxEnd = Math.min(state.frequency.length - 1, Math.ceil(420 / binHz));
    for (var b = fluxStart; b <= fluxEnd; b++) {
      var current = state.frequency[b] / 255;
      var delta = current - state.previousSpectrum[b];
      if (delta > 0) spectrumFlux += delta;
      state.previousSpectrum[b] = current;
      fluxCount++;
    }
    spectrumFlux = fluxCount ? spectrumFlux / fluxCount : 0;

    state.fastLow = realtimeFollow(state.fastLow, low, dt, 0.014, 0.072);
    state.slowLow = realtimeFollow(state.slowLow, low, dt, 0.260, 0.480);
    state.fastBody = realtimeFollow(state.fastBody, body, dt, 0.020, 0.090);
    state.slowBody = realtimeFollow(state.slowBody, body, dt, 0.320, 0.560);
    var lowRise = Math.max(0, state.fastLow - state.slowLow);
    var bodyRise = Math.max(0, state.fastBody - state.slowBody);
    var onset = lowRise * 1.72 + lowFlux * 1.20 + spectrumFlux * 0.92 + rmsFlux * 0.34 + bodyRise * 0.10;
    state.onsetMean = realtimeFollow(state.onsetMean, onset, dt, 0.75, 0.38);
    state.onsetDeviation = realtimeFollow(state.onsetDeviation, Math.abs(onset - state.onsetMean), dt, 0.95, 0.55);
    state.noiseFloor = realtimeFollow(state.noiseFloor, rms, dt, 2.4, 0.65);
    state.peakLow = Math.max(state.peakLow * Math.pow(0.990, dt * 60), low, 0.055);
    state.peakBody = Math.max(state.peakBody * Math.pow(0.991, dt * 60), body, 0.045);
    state.peakHigh = Math.max(state.peakHigh * Math.pow(0.991, dt * 60), high, 0.035);
    state.peakRms = Math.max(state.peakRms * Math.pow(0.993, dt * 60), rms, 0.020);
    state.previousLow = low;
    state.previousRms = rms;
    state.warmupFrames++;

    var lowNorm = Math.max(0, Math.min(1, low / Math.max(0.055, state.peakLow * 0.72)));
    var bodyNorm = Math.max(0, Math.min(1, body / Math.max(0.045, state.peakBody * 0.74)));
    var midNorm = Math.max(0, Math.min(1, mid / Math.max(0.040, state.peakBody * 0.68)));
    var highNorm = Math.max(0, Math.min(1, high / Math.max(0.035, state.peakHigh * 0.74)));
    var rmsNorm = Math.max(0, Math.min(1, rms / Math.max(0.020, state.peakRms * 0.70)));

    if (window.frequencyData && typeof window.frequencyData.set === 'function') {
      var target = window.frequencyData;
      var step = state.frequency.length / Math.max(1, target.length);
      for (var j = 0; j < target.length; j++) target[j] = state.frequency[Math.min(state.frequency.length - 1, Math.floor(j * step))];
    }

    var silenceGate = rms > Math.max(0.0045, state.noiseFloor * 0.72);
    var threshold = state.onsetMean + Math.max(0.0065, state.onsetDeviation * 1.75);
    var nowSec = performance.now() / 1000;
    var gap = nowSec - state.lastHitAt;
    var candidate = state.warmupFrames > 14
      && silenceGate
      && lowNorm > 0.34
      && onset > threshold
      && (lowRise > 0.010 || lowFlux > 0.014 || spectrumFlux > 0.010)
      && gap > 0.225;
    var score = Math.max(0, Math.min(1, (onset - threshold) / Math.max(0.010, state.onsetDeviation * 3.2)));
    var strength = Math.max(0, Math.min(1, 0.20 + lowNorm * 0.40 + score * 0.28 + rmsNorm * 0.12));
    if (candidate && strength > 0.46) {
      state.lastHitAt = nowSec;
      triggerSpotifyRealtimeBeat(window.getPlaybackCurrentSeconds(), strength, Math.max(0.42, score), lowNorm, bodyNorm, highNorm);
    }

    spotifyDirectState.visualPulse *= Math.pow(0.12, dt);
    var bassTarget = silenceGate ? Math.min(0.82, lowNorm * 0.72 + rmsNorm * 0.08) : 0;
    var midTarget = silenceGate ? Math.min(0.62, bodyNorm * 0.40 + midNorm * 0.30) : 0;
    var highTarget = silenceGate ? Math.min(0.52, highNorm * 0.42) : 0;
    var energyTarget = silenceGate ? Math.min(0.72, rmsNorm * 0.58 + lowNorm * 0.14 + midNorm * 0.10) : 0;
    window.smoothBass = realtimeFollow(Number(window.smoothBass) || 0, bassTarget, dt, 0.025, 0.110);
    window.smoothMid = realtimeFollow(Number(window.smoothMid) || 0, midTarget, dt, 0.040, 0.145);
    window.smoothTreb = realtimeFollow(Number(window.smoothTreb) || 0, highTarget, dt, 0.035, 0.135);
    window.smoothEnergy = realtimeFollow(Number(window.smoothEnergy) || 0, energyTarget, dt, 0.040, 0.150);
    window.beatPulse = Math.max(Number(window.beatPulse) || 0, spotifyDirectState.visualPulse);
    window.lyricSunTarget = Math.min(0.74, window.smoothEnergy * 0.70 + window.smoothMid * 0.24 + spotifyDirectState.visualPulse * 0.16);
    window.lyricSunEnergy = realtimeFollow(Number(window.lyricSunEnergy) || 0, window.lyricSunTarget, dt, 0.060, 0.180);
    return true;
  }

  function currentSong() {
    return window.playQueue && window.currentIdx >= 0 ? window.playQueue[window.currentIdx] : null;
  }

  function isSpotifySong(song) {
    if (!song) return false;
    return song.realProvider === 'spotify'
      || song.provider === 'spotify'
      || song.source === 'spotify'
      || !!song.spotifyUri
      || !!song.spotifyId;
  }
  window.isSpotifyDirectSong = isSpotifySong;

  function spotifyTrackIdFromUri(uri) {
    var match = String(uri || '').match(/^spotify:track:([A-Za-z0-9]{16,32})$/);
    return match ? match[1] : '';
  }

  function selectedSpotifyTrackId(song) {
    if (!song) return '';
    var fromUri = spotifyTrackIdFromUri(song.spotifyUri);
    var candidate = String(song.spotifyId || fromUri || song.id || '').trim();
    return /^[A-Za-z0-9]{16,32}$/.test(candidate) ? candidate : '';
  }

  function exactSpotifyTrackUri(song, descriptor) {
    var candidates = [
      descriptor && descriptor.spotifyUri,
      descriptor && descriptor.metadata && descriptor.metadata.spotifyUri,
      song && song.spotifyUri
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (spotifyTrackIdFromUri(candidates[i])) return String(candidates[i]);
    }
    var id = String(descriptor && descriptor.spotifyId || selectedSpotifyTrackId(song) || '');
    return /^[A-Za-z0-9]{16,32}$/.test(id) ? 'spotify:track:' + id : '';
  }

  function spotifyDelay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
  }

  function isSpotifyActive() {
    return window.activePlaybackTransport === 'spotify' && spotifyDirectState.active;
  }
  window.isSpotifyPlaybackActive = isSpotifyActive;

  function monotonicNowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function nowPositionMs() {
    if (spotifyDirectState.seeking) return Math.max(0, Number(spotifyDirectState.seekTargetMs || spotifyDirectState.positionMs || 0));
    var helper = window.ShinaYuuLyricsSync;
    var now = monotonicNowMs();
    if (helper && typeof helper.monotonicPositionSeconds === 'function') {
      return helper.monotonicPositionSeconds(
        Number(spotifyDirectState.positionMs || 0) / 1000,
        Number(spotifyDirectState.clockUpdatedAt || now),
        !!spotifyDirectState.isPlaying,
        1,
        now,
        Number(spotifyDirectState.durationMs || 0) / 1000
      ) * 1000;
    }
    var position = Number(spotifyDirectState.positionMs || 0);
    if (spotifyDirectState.isPlaying && spotifyDirectState.clockUpdatedAt) {
      position += Math.max(0, now - spotifyDirectState.clockUpdatedAt);
    }
    var duration = Number(spotifyDirectState.durationMs || 0);
    return duration > 0 ? Math.min(position, duration) : position;
  }

  function updateSpotifyState(next, source) {
    next = next || {};
    var previousPlaying = spotifyDirectState.isPlaying;
    var previousPosition = nowPositionMs();
    var previousDuration = Number(spotifyDirectState.durationMs || 0);
    var previousUri = String(spotifyDirectState.currentUri || '');

    // Spotify can emit one or more stale player_state_changed snapshots after
    // a seek request. Do not let those snapshots pull the progress bar back
    // to the old position or make the end-of-track detector restart the song.
    if (spotifyDirectState.seeking && next.positionMs != null) {
      var incomingPosition = Math.max(0, Number(next.positionMs) || 0);
      var seekDistance = Math.abs(incomingPosition - Number(spotifyDirectState.seekTargetMs || 0));
      var seekAge = Date.now() - Number(spotifyDirectState.seekStartedAt || 0);
      if (seekDistance <= 1800) {
        spotifyDirectState.seeking = false;
      } else if (seekAge < 4200) {
        next = Object.assign({}, next);
        delete next.positionMs;
      } else {
        spotifyDirectState.seeking = false;
      }
    }

    if (next.mode) spotifyDirectState.mode = next.mode;
    if (next.deviceId != null) spotifyDirectState.deviceId = String(next.deviceId || '');
    if (next.deviceName != null) spotifyDirectState.deviceName = String(next.deviceName || '');
    if (next.currentUri != null) spotifyDirectState.currentUri = String(next.currentUri || '');
    if (next.currentTrackId != null) spotifyDirectState.currentTrackId = String(next.currentTrackId || '');
    if (next.positionMs != null) spotifyDirectState.positionMs = Math.max(0, Number(next.positionMs) || 0);
    if (next.durationMs != null) spotifyDirectState.durationMs = Math.max(0, Number(next.durationMs) || 0);
    if (next.isPlaying != null) spotifyDirectState.isPlaying = !!next.isPlaying;
    spotifyDirectState.updatedAt = Date.now();
    spotifyDirectState.clockUpdatedAt = monotonicNowMs();

    if (!isSpotifyActive()) return;
    var currentPosition = nowPositionMs();
    var positionJump = next.positionMs != null ? Math.abs(currentPosition - previousPosition) : 0;
    if ((next.currentUri != null && previousUri && String(next.currentUri || '') !== previousUri) || positionJump > 1450) {
      if (typeof window.onPlaybackClockDiscontinuity === 'function') window.onPlaybackClockDiscontinuity(currentPosition / 1000, 'spotify-state');
    }
    if (next.durationMs != null && Math.abs(Number(spotifyDirectState.durationMs || 0) - previousDuration) > 250) {
      if (typeof window.refreshLyricTimelineForPlaybackDuration === 'function') window.refreshLyricTimelineForPlaybackDuration(Number(spotifyDirectState.durationMs || 0) / 1000);
    }
    window.playing = spotifyDirectState.isPlaying;
    if (typeof window.setPlayIcon === 'function') window.setPlayIcon(window.playing);
    if (typeof window.updatePlaybackProgressUi === 'function') window.updatePlaybackProgressUi();
    if (typeof window.forcePlaybackControlsInteractive === 'function') window.forcePlaybackControlsInteractive();
    if (window.playing && typeof window.switchPlaybackVisualToEmily === 'function') window.switchPlaybackVisualToEmily();
    if (!window.playing && typeof window.hideLoading === 'function') window.hideLoading();

    var ended = !spotifyDirectState.seeking
      && previousPlaying
      && previousDuration > 0
      && previousPosition >= previousDuration - 1600
      && !spotifyDirectState.isPlaying;
    var endKey = spotifyDirectState.currentUri + ':' + Math.round(previousDuration);
    if (ended && endKey && spotifyDirectState.endedHandledFor !== endKey) {
      spotifyDirectState.endedHandledFor = endKey;
      setTimeout(function () {
        if (!isSpotifyActive()) return;
        try { if (typeof window.finalizeListenSession === 'function') window.finalizeListenSession(true); } catch (_) {}
        if (window.playMode === 'single') window.playQueueAt(window.currentIdx, { autoRepeat: true });
        else if (typeof window.nextTrack === 'function') window.nextTrack();
      }, 120);
    }

    spotifyDirectState.lastStateWasPlaying = previousPlaying;
    spotifyDirectState.lastStatePositionMs = previousPosition;
    spotifyDirectState.lastStateDurationMs = previousDuration;
  }

  async function postJson(path, body) {
    return window.apiJson(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  function localized(vi, en) {
    return window.appLanguage === 'en' ? en : vi;
  }

  function playerErrorMessage(error) {
    var raw = String(error && (error.message || error.error) || error || '');
    if (/premium/i.test(raw)) return localized('Spotify Premium là bắt buộc để phát trực tiếp.', 'Spotify Premium is required for direct playback.');
    if (/scope|permission|403|reauthor/i.test(raw)) return localized('Hãy ngắt kết nối rồi đăng nhập lại Spotify để cấp quyền phát nhạc.', 'Disconnect and reconnect Spotify to grant playback permissions.');
    if (/SPOTIFY_HOST_NOT_READY/i.test(raw)) return localized('Bộ phát Spotify WebView2 ẩn chưa sẵn sàng. Hãy chờ vài giây hoặc kết nối lại Spotify.', 'The hidden Spotify WebView2 player is not ready. Wait a few seconds or reconnect Spotify.');
    if (/device|NO_ACTIVE_DEVICE|404/i.test(raw)) return localized('Không thể tạo bộ phát Spotify bên trong ShinaYuu Music. Hãy kết nối lại Spotify.', 'Could not create the Spotify player inside ShinaYuu Music. Reconnect Spotify.');
    if (/account|token|login|401/i.test(raw)) return localized('Hãy kết nối lại tài khoản Spotify.', 'Reconnect your Spotify account.');
    if (/SPOTIFY_IN_APP_RUNTIME_REQUIRED/i.test(raw)) return localized('Spotify phải chạy trong ứng dụng ShinaYuu Music bản WebView2. Hãy chạy bằng npm start.', 'Spotify must run in the WebView2 edition of ShinaYuu Music. Start it with npm start.');
    if (/SPOTIFY_AUDIO_NOT_ACTIVATED|AUTOPLAY/i.test(raw)) return localized('Âm thanh Spotify chưa được kích hoạt. Hãy nhấn trực tiếp nút Phát một lần nữa.', 'Spotify audio is not activated yet. Press the Play button once more.');
    if (/SPOTIFY_WRONG_TRACK|DESCRIPTOR_MISMATCH/i.test(raw)) return localized('Spotify vẫn giữ bài cũ nên ShinaYuu Music đã chặn trạng thái sai. Hãy bấm lại bài vừa chọn.', 'Spotify kept the previous track, so ShinaYuu Music blocked the incorrect state. Press the selected track again.');
    if (/SPOTIFY_SDK_PLAYBACK_NOT_CONFIRMED/i.test(raw)) return localized('Bộ phát Spotify không xác nhận được âm thanh trong ứng dụng. Hãy kết nối lại Spotify rồi thử lại.', 'The Spotify player could not confirm in-app audio. Reconnect Spotify and try again.');
    return raw || localized('Không thể bắt đầu phát trực tiếp từ Spotify.', 'Could not start direct Spotify playback.');
  }

  function targetSpotifyVolume() {
    var value = Number(window.targetVolume);
    if (!Number.isFinite(value)) value = 0.65;
    return Math.max(0, Math.min(1, value));
  }

  async function applySpotifySdkVolume(player) {
    var value = targetSpotifyVolume();
    if (usesRemoteSpotifyHost()) {
      await postJson('/api/spotify/host/volume', {
        volume: value,
        volumePercent: Math.round(value * 100)
      }).catch(async function () {
        if (spotifyDirectState.deviceId) {
          await postJson('/api/spotify/player/volume', {
            deviceId: spotifyDirectState.deviceId,
            volumePercent: Math.round(value * 100)
          }).catch(function () {});
        }
      });
      return value;
    }
    player = player || spotifyDirectState.sdkPlayer;
    if (!player || typeof player.setVolume !== 'function') return value;
    await player.setVolume(value);
    return value;
  }

  function activateSpotifyAudioFromGesture() {
    if (usesRemoteSpotifyHost()) return;
    var player = spotifyDirectState.sdkPlayer;
    if (!player || typeof player.activateElement !== 'function') return;
    try {
      var result = player.activateElement();
      spotifyDirectState.audioActivated = true;
      if (result && typeof result.then === 'function') {
        result.then(function () {
          spotifyDirectState.audioActivated = true;
          applySpotifySdkVolume(player).catch(function () {});
        }).catch(function () {
          spotifyDirectState.audioActivated = false;
        });
      }
    } catch (_) {
      spotifyDirectState.audioActivated = false;
    }
  }

  function sdkTrackUri(state) {
    if (state && state.currentUri) return String(state.currentUri || '');
    var current = state && state.track_window && state.track_window.current_track;
    return current && current.uri || '';
  }

  function usesRemoteSpotifyHost() {
    return /\bElectron\//i.test(String(navigator.userAgent || ''));
  }

  function remoteHostStateToSdkState(host) {
    host = host || {};
    return {
      currentUri: String(host.currentUri || ''),
      position: Number(host.positionMs || 0),
      duration: Number(host.durationMs || 0),
      paused: host.isPlaying !== true,
      track_window: {
        current_track: {
          uri: String(host.currentUri || ''),
          id: String(host.currentTrackId || '')
        }
      }
    };
  }

  async function waitForRemoteHostReady(timeoutMs) {
    var started = Date.now();
    timeoutMs = Math.max(2500, Number(timeoutMs) || 12000);
    var last = null;
    while (Date.now() - started < timeoutMs) {
      last = await window.apiJson('/api/spotify/host/status?t=' + Date.now()).catch(function () { return null; });
      if (last && last.alive && last.ready && last.deviceId) {
        spotifyDirectState.sdkReady = true;
        spotifyDirectState.deviceId = String(last.deviceId || '');
        spotifyDirectState.deviceName = String(last.deviceName || 'ShinaYuu Music');
        spotifyDirectState.mode = 'remote-sdk';
        return { id: spotifyDirectState.deviceId, name: spotifyDirectState.deviceName, mode: 'remote-sdk' };
      }
      await spotifyDelay(220);
    }
    var suffix = last && last.error ? ':' + last.error : '';
    throw new Error('SPOTIFY_HOST_NOT_READY' + suffix);
  }

  async function waitForSdkPlayback(uri, timeoutMs) {
    if (usesRemoteSpotifyHost()) {
      var remoteStarted = Date.now();
      var remoteLastPosition = -1;
      var remoteWrongUri = '';
      var remoteWrongSince = 0;
      timeoutMs = Math.max(2500, Number(timeoutMs) || 10000);
      while (Date.now() - remoteStarted < timeoutMs) {
        var host = await window.apiJson('/api/spotify/host/status?t=' + Date.now()).catch(function () { return null; });
        if (host && host.errorType === 'playback_error' && host.error) throw new Error(host.error);
        var actual = host && String(host.currentUri || '');
        if (host && host.alive && host.ready && actual === uri && host.isPlaying) {
          var remotePosition = Number(host.positionMs || 0);
          if (remoteLastPosition < 0) remoteLastPosition = remotePosition;
          else if (remotePosition > remoteLastPosition + 20 || (remotePosition === 0 && Date.now() - remoteStarted > 900)) {
            return remoteHostStateToSdkState(host);
          }
        } else if (host && host.isPlaying && actual && actual !== uri) {
          if (remoteWrongUri !== actual) {
            remoteWrongUri = actual;
            remoteWrongSince = Date.now();
          } else if (Date.now() - remoteWrongSince > 1100) {
            throw new Error('SPOTIFY_WRONG_TRACK:' + actual);
          }
        }
        await spotifyDelay(180);
      }
      throw new Error('SPOTIFY_SDK_PLAYBACK_NOT_CONFIRMED');
    }

    var player = spotifyDirectState.sdkPlayer;
    if (!player || typeof player.getCurrentState !== 'function') throw new Error('SPOTIFY_SDK_NOT_READY');
    var started = Date.now();
    var lastPosition = -1;
    var wrongUri = '';
    var wrongSince = 0;
    timeoutMs = Math.max(2500, Number(timeoutMs) || 10000);
    while (Date.now() - started < timeoutMs) {
      if (spotifyDirectState.sdkPlaybackError) throw new Error(spotifyDirectState.sdkPlaybackError);
      var state = await player.getCurrentState().catch(function () { return null; });
      var actualUri = sdkTrackUri(state);
      if (state && actualUri === uri && state.paused === false) {
        var position = Number(state.position || 0);
        if (lastPosition < 0) lastPosition = position;
        else if (position > lastPosition + 20 || (position === 0 && Date.now() - started > 800)) return state;
      } else if (state && actualUri && actualUri !== uri && state.paused === false) {
        if (wrongUri !== actualUri) {
          wrongUri = actualUri;
          wrongSince = Date.now();
        } else if (Date.now() - wrongSince > 900) {
          var wrongTrackError = new Error('SPOTIFY_WRONG_TRACK:' + actualUri);
          wrongTrackError.actualUri = actualUri;
          wrongTrackError.expectedUri = uri;
          throw wrongTrackError;
        }
      }
      await spotifyDelay(180);
    }
    throw new Error(spotifyDirectState.audioActivated ? 'SPOTIFY_SDK_PLAYBACK_NOT_CONFIRMED' : 'SPOTIFY_AUDIO_NOT_ACTIVATED');
  }

  async function playSpotifyUriExactly(device, uri, positionMs, requestId) {
    if (!device || !device.id) throw new Error('SPOTIFY_SDK_NOT_READY');
    if (!spotifyTrackIdFromUri(uri)) throw new Error('SPOTIFY_TRACK_URI_REQUIRED');

    var lastError = null;
    for (var attempt = 1; attempt <= 3; attempt++) {
      spotifyDirectState.playRequestId = requestId;
      console.info('[SpotifyPlayback] request=' + requestId + ' attempt=' + attempt + ' target=' + uri + ' device=' + device.id);

      // Target the SDK device directly. Do not transfer first: Spotify warns
      // that ordering is not guaranteed when multiple Player endpoints are
      // combined, which can otherwise resume the previous Spotify track.
      if (attempt === 3) {
        await postJson('/api/spotify/player/transfer', {
          deviceId: device.id,
          play: false,
          requestId: requestId
        }).catch(function (error) {
          console.warn('[SpotifyPlayback] fallback transfer failed', error && (error.message || error));
        });
        await spotifyDelay(700);
      }

      try {
        await postJson('/api/spotify/player/play', {
          deviceId: device.id,
          uri: uri,
          positionMs: positionMs,
          requestId: requestId,
          forceTrack: true
        });
        return await waitForSdkPlayback(uri, attempt === 1 ? 4200 : 6200);
      } catch (error) {
        lastError = error;
        console.warn('[SpotifyPlayback] exact-track attempt failed', requestId, attempt, error && (error.message || error));
        if (attempt < 3) await spotifyDelay(450 + attempt * 250);
      }
    }
    throw lastError || new Error('SPOTIFY_SDK_PLAYBACK_NOT_CONFIRMED');
  }

  function prewarmSpotifyDirectPlayer() {
    if (spotifyDirectState.prewarmPromise || spotifyDirectState.sdkReady) return spotifyDirectState.prewarmPromise || Promise.resolve(true);
    if (!isSupportedSpotifyRuntime()) return Promise.resolve(false);
    spotifyDirectState.prewarmPromise = window.apiJson('/api/login/status?t=' + Date.now())
      .then(function (status) {
        if (!status || !status.loggedIn) return false;
        return ensureSdkDevice(15000).then(function () { return true; });
      })
      .catch(function (error) {
        var raw = String(error && (error.message || error) || '');
        if (!/401|token|login|SPOTIFY_TOKEN_MISSING/i.test(raw)) console.warn('[SpotifySDK prewarm]', raw);
        return false;
      })
      .finally(function () { spotifyDirectState.prewarmPromise = null; });
    return spotifyDirectState.prewarmPromise;
  }

  function loadSpotifySdk() {
    if (window.Spotify && window.Spotify.Player) return Promise.resolve(window.Spotify);
    if (spotifyDirectState.sdkScriptPromise) return spotifyDirectState.sdkScriptPromise;
    spotifyDirectState.sdkScriptPromise = new Promise(function (resolve, reject) {
      var settled = false;
      var previousReady = window.onSpotifyWebPlaybackSDKReady;
      function finishOk() {
        if (settled) return;
        settled = true;
        try { if (typeof previousReady === 'function') previousReady(); } catch (_) {}
        resolve(window.Spotify);
      }
      window.onSpotifyWebPlaybackSDKReady = finishOk;
      var existing = document.querySelector('script[data-shinayuu-spotify-sdk]');
      if (!existing) {
        var script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        script.dataset.shinayuuSpotifySdk = '1';
        script.onerror = function () {
          if (settled) return;
          settled = true;
          reject(new Error('SPOTIFY_SDK_LOAD_FAILED'));
        };
        document.head.appendChild(script);
      }
      var started = Date.now();
      var timer = setInterval(function () {
        if (window.Spotify && window.Spotify.Player) {
          clearInterval(timer);
          finishOk();
        } else if (Date.now() - started > 9000) {
          clearInterval(timer);
          if (!settled) {
            settled = true;
            reject(new Error('SPOTIFY_SDK_TIMEOUT'));
          }
        }
      }, 120);
    }).catch(function (error) {
      spotifyDirectState.sdkScriptPromise = null;
      throw error;
    });
    return spotifyDirectState.sdkScriptPromise;
  }

  function getFreshSpotifyToken(callback) {
    window.apiJson('/api/spotify/player/token?t=' + Date.now())
      .then(function (data) {
        if (!data || !data.accessToken) throw new Error('SPOTIFY_TOKEN_MISSING');
        if (data.playbackScopesReady === false) throw new Error('SPOTIFY_REAUTHORIZATION_REQUIRED');
        callback(data.accessToken);
      })
      .catch(function (error) {
        spotifyDirectState.sdkError = playerErrorMessage(error);
      });
  }

  async function ensureSdkDevice(timeoutMs) {
    timeoutMs = Math.max(1200, Number(timeoutMs) || 4500);
    if (usesRemoteSpotifyHost()) {
      return waitForRemoteHostReady(Math.max(timeoutMs, 12000));
    }
    if (spotifyDirectState.sdkReady && spotifyDirectState.deviceId) {
      return { id: spotifyDirectState.deviceId, name: spotifyDirectState.deviceName || 'ShinaYuu Music', mode: 'sdk' };
    }

    if (!spotifyDirectState.sdkPlayer) {
      if (!spotifyDirectState.sdkCreatingPromise) {
        spotifyDirectState.sdkCreatingPromise = (async function () {
          await loadSpotifySdk();
          if (spotifyDirectState.sdkPlayer) return;

          spotifyDirectState.sdkPromise = new Promise(function (resolve, reject) {
            spotifyDirectState.sdkResolve = resolve;
            spotifyDirectState.sdkReject = reject;
          });
          var player = new window.Spotify.Player({
            name: 'ShinaYuu Music',
            getOAuthToken: getFreshSpotifyToken,
            volume: targetSpotifyVolume()
          });
          spotifyDirectState.sdkPlayer = player;
          player.addListener('ready', function (payload) {
            spotifyDirectState.sdkReady = true;
            spotifyDirectState.sdkPlaybackError = '';
            spotifyDirectState.deviceId = payload && payload.device_id || '';
            spotifyDirectState.deviceName = 'ShinaYuu Music';
            applySpotifySdkVolume(player).catch(function (error) { console.warn('[SpotifyVolume ready]', error); });
            if (spotifyDirectState.sdkResolve) spotifyDirectState.sdkResolve({ id: spotifyDirectState.deviceId, name: spotifyDirectState.deviceName, mode: 'sdk' });
          });
          player.addListener('not_ready', function (payload) {
            if (payload && payload.device_id === spotifyDirectState.deviceId) {
              spotifyDirectState.sdkReady = false;
              spotifyDirectState.deviceId = '';
              spotifyDirectState.sdkPromise = null;
            }
          });
          ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(function (eventName) {
            player.addListener(eventName, function (payload) {
              var msg = payload && payload.message || eventName;
              spotifyDirectState.sdkError = msg;
              if (eventName === 'playback_error') spotifyDirectState.sdkPlaybackError = msg;
              if (!spotifyDirectState.sdkReady && spotifyDirectState.sdkReject) spotifyDirectState.sdkReject(new Error(msg));
              console.warn('[SpotifySDK]', eventName, msg);
            });
          });
          player.addListener('autoplay_failed', function () {
            spotifyDirectState.sdkError = 'SPOTIFY_AUTOPLAY_FAILED';
            spotifyDirectState.audioActivated = false;
            if (typeof window.showToast === 'function') {
              window.showToast(localized('Nhấn nút Phát thêm một lần để kích hoạt âm thanh Spotify trong ứng dụng.', 'Press Play once more to activate Spotify audio inside the app.'));
            }
          });
          player.addListener('player_state_changed', function (state) {
            if (!state) return;
            spotifyDirectState.sdkStateReceivedAt = Date.now();
            spotifyDirectState.sdkPlaybackError = '';
            var current = state.track_window && state.track_window.current_track;
            var uri = current && current.uri || '';
            spotifyDirectState.lastActualUri = uri;

            if (spotifyDirectState.switchingTrack && spotifyDirectState.requestedUri && uri && uri !== spotifyDirectState.requestedUri) {
              if (!spotifyDirectState.wrongTrackSince) spotifyDirectState.wrongTrackSince = Date.now();
              console.warn('[SpotifySDK] stale-track state ignored request=' + spotifyDirectState.playRequestId + ' expected=' + spotifyDirectState.requestedUri + ' actual=' + uri);
              return;
            }
            if (uri && spotifyDirectState.requestedUri && uri === spotifyDirectState.requestedUri) {
              spotifyDirectState.switchingTrack = false;
              spotifyDirectState.wrongTrackSince = 0;
            }

            updateSpotifyState({
              mode: 'sdk',
              currentUri: uri || spotifyDirectState.currentUri,
              currentTrackId: uri ? uri.split(':').pop() : spotifyDirectState.currentTrackId,
              positionMs: Number(state.position || 0),
              durationMs: Number(state.duration || current && current.duration_ms || 0),
              isPlaying: !state.paused
            }, 'sdk');
          });
          var connected = await player.connect();
          if (!connected) throw new Error('SPOTIFY_SDK_CONNECT_FAILED');
        })().finally(function () {
          spotifyDirectState.sdkCreatingPromise = null;
        });
      }
      await spotifyDirectState.sdkCreatingPromise;
    } else if (!spotifyDirectState.sdkReady && !spotifyDirectState.sdkPromise) {
      spotifyDirectState.sdkPromise = new Promise(function (resolve, reject) {
        spotifyDirectState.sdkResolve = resolve;
        spotifyDirectState.sdkReject = reject;
      });
      var reconnected = await spotifyDirectState.sdkPlayer.connect();
      if (!reconnected) throw new Error('SPOTIFY_SDK_CONNECT_FAILED');
    }

    var readyPromise = spotifyDirectState.sdkReady && spotifyDirectState.deviceId
      ? Promise.resolve({ id: spotifyDirectState.deviceId, name: spotifyDirectState.deviceName || 'ShinaYuu Music', mode: 'sdk' })
      : spotifyDirectState.sdkPromise;
    if (!readyPromise) throw new Error('SPOTIFY_SDK_NOT_READY');
    return Promise.race([
      readyPromise,
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error(spotifyDirectState.sdkError || 'SPOTIFY_SDK_NOT_READY')); }, timeoutMs); })
    ]);
  }

  function isSupportedSpotifyRuntime() {
    // The visible application is the original Electron shell. On Windows,
    // protected Spotify audio is rendered by an off-screen WebView2 host, so
    // the renderer remains fully compatible with the original Mineradio UI.
    if (usesRemoteSpotifyHost()) return true;
    var runtime = '';
    try { runtime = new URLSearchParams(location.search).get('runtime') || ''; } catch (_) {}
    return runtime === 'native-webview2' || runtime === 'spotify-web-shell' || !runtime;
  }

  async function resolveSpotifyDevice() {
    if (!isSupportedSpotifyRuntime()) {
      throw new Error('SPOTIFY_IN_APP_RUNTIME_REQUIRED');
    }

    // Strict in-app playback: never enumerate, select, transfer to, or launch
    // Spotify Desktop/mobile devices. The only acceptable device is the
    // Spotify Web Playback SDK instance hosted by this ShinaYuu Music window.
    var sdkDevice = await ensureSdkDevice(12000);
    if (!sdkDevice || !sdkDevice.id) throw new Error('SPOTIFY_SDK_NOT_READY');
    return { id: sdkDevice.id, name: 'ShinaYuu Music', mode: 'sdk', active: false };
  }

  function stopSpotifyClockSync() {
    if (spotifyDirectState.clockSyncTimer) {
      clearInterval(spotifyDirectState.clockSyncTimer);
      spotifyDirectState.clockSyncTimer = null;
    }
    spotifyDirectState.clockSyncBusy = false;
  }

  async function syncSpotifySdkClock() {
    if (!isSpotifyActive() || spotifyDirectState.mode !== 'sdk' || !spotifyDirectState.sdkPlayer || spotifyDirectState.seeking || spotifyDirectState.clockSyncBusy) return;
    spotifyDirectState.clockSyncBusy = true;
    try {
      var state = await spotifyDirectState.sdkPlayer.getCurrentState().catch(function () { return null; });
      if (!state || !isSpotifyActive()) return;
      var current = state.track_window && state.track_window.current_track;
      var uri = current && current.uri || '';
      if (spotifyDirectState.currentUri && uri && spotifyDirectState.currentUri !== uri) return;
      var actualMs = Math.max(0, Number(state.position || 0));
      var estimatedMs = nowPositionMs();
      var driftMs = actualMs - estimatedMs;
      var playingChanged = spotifyDirectState.isPlaying !== !state.paused;
      // player_state_changed is documented to arrive at random intervals.
      // Re-anchor to the SDK clock when drift reaches roughly two frames so
      // lyric transitions use the same playback position as Spotify.
      if (playingChanged || Math.abs(driftMs) >= 34) {
        updateSpotifyState({
          mode: 'sdk',
          currentUri: uri || spotifyDirectState.currentUri,
          currentTrackId: uri ? uri.split(':').pop() : spotifyDirectState.currentTrackId,
          positionMs: actualMs,
          durationMs: Number(state.duration || current && current.duration_ms || spotifyDirectState.durationMs || 0),
          isPlaying: !state.paused
        }, 'sdk-clock-sync');
      }
    } catch (error) {
      console.warn('[SpotifyClockSync]', error && (error.message || error));
    } finally {
      spotifyDirectState.clockSyncBusy = false;
    }
  }

  function startSpotifyClockSync() {
    stopSpotifyClockSync();
    if (spotifyDirectState.mode !== 'sdk' || !spotifyDirectState.sdkPlayer) return;
    spotifyDirectState.clockSyncTimer = setInterval(syncSpotifySdkClock, 500);
    setTimeout(syncSpotifySdkClock, 120);
  }

  function stopSpotifyPolling() {
    if (spotifyDirectState.pollTimer) {
      clearInterval(spotifyDirectState.pollTimer);
      spotifyDirectState.pollTimer = null;
    }
    stopSpotifyClockSync();
  }

  async function pollSpotifyState() {
    if (!isSpotifyActive()) return;
    try {
      if (usesRemoteSpotifyHost()) {
        var host = await window.apiJson('/api/spotify/host/status?t=' + Date.now());
        if (!host || !host.alive) return;
        if (spotifyDirectState.currentUri && host.currentUri && spotifyDirectState.currentUri !== host.currentUri) return;
        updateSpotifyState({
          mode: 'remote-sdk',
          deviceId: host.deviceId || spotifyDirectState.deviceId,
          deviceName: host.deviceName || spotifyDirectState.deviceName,
          currentUri: host.currentUri || spotifyDirectState.currentUri,
          currentTrackId: host.currentTrackId || spotifyDirectState.currentTrackId,
          positionMs: Number(host.positionMs || 0),
          durationMs: Number(host.durationMs || spotifyDirectState.durationMs || 0),
          isPlaying: !!host.isPlaying
        }, 'remote-host');
        return;
      }
      var state = await window.apiJson('/api/spotify/player/state?t=' + Date.now());
      if (!state) return;
      var track = state.track || {};
      var uri = track.spotifyUri || track.uri || (track.id ? 'spotify:track:' + track.id : spotifyDirectState.currentUri);
      if (spotifyDirectState.currentUri && uri && spotifyDirectState.currentUri !== uri) return;
      updateSpotifyState({
        deviceId: state.device && state.device.id || spotifyDirectState.deviceId,
        deviceName: state.device && state.device.name || spotifyDirectState.deviceName,
        currentUri: uri,
        currentTrackId: track.spotifyId || track.id || spotifyDirectState.currentTrackId,
        positionMs: Number(state.progressMs || 0),
        durationMs: Number(state.durationMs || track.duration || spotifyDirectState.durationMs || 0),
        isPlaying: !!state.isPlaying
      }, 'poll');
    } catch (error) {
      console.warn('[SpotifyState]', error && (error.message || error));
    }
  }

  function startSpotifyPolling() {
    stopSpotifyPolling();
    // The SDK state is the source of truth for in-app playback. Polling the
    // Web API here can make the UI look active even when local audio failed.
    if (spotifyDirectState.mode === 'sdk' && spotifyDirectState.sdkPlayer) {
      startSpotifyClockSync();
      return;
    }
    spotifyDirectState.pollTimer = setInterval(pollSpotifyState, 1700);
    setTimeout(pollSpotifyState, 350);
  }

  async function pauseSpotifyDirect(silent) {
    if (!isSpotifyActive()) return false;
    try {
      if (spotifyDirectState.mode === 'sdk' && spotifyDirectState.sdkPlayer) await spotifyDirectState.sdkPlayer.pause();
      else await postJson('/api/spotify/player/pause', { deviceId: spotifyDirectState.deviceId });
      updateSpotifyState({ positionMs: nowPositionMs(), isPlaying: false }, 'pause');
      try { if (typeof window.updateListenStatsTick === 'function') window.updateListenStatsTick(true); } catch (_) {}
      return true;
    } catch (error) {
      if (!silent && typeof window.showToast === 'function') window.showToast(playerErrorMessage(error));
      return false;
    }
  }

  async function resumeSpotifyDirect() {
    if (!isSpotifyActive()) return false;
    try {
      if (spotifyDirectState.mode === 'sdk' && spotifyDirectState.sdkPlayer) {
        activateSpotifyAudioFromGesture();
        await applySpotifySdkVolume(spotifyDirectState.sdkPlayer);
        await spotifyDirectState.sdkPlayer.resume();
        var resumedState = await waitForSdkPlayback(spotifyDirectState.currentUri, 7000);
        updateSpotifyState({
          positionMs: Number(resumedState.position || nowPositionMs()),
          durationMs: Number(resumedState.duration || spotifyDirectState.durationMs || 0),
          isPlaying: !resumedState.paused
        }, 'resume-confirmed');
      } else {
        await postJson('/api/spotify/player/resume', { deviceId: spotifyDirectState.deviceId });
        updateSpotifyState({ positionMs: nowPositionMs(), isPlaying: true }, 'resume');
      }
      return true;
    } catch (error) {
      if (typeof window.showToast === 'function') window.showToast(playerErrorMessage(error));
      return false;
    }
  }

  async function readSpotifySeekState() {
    if (usesRemoteSpotifyHost()) {
      var host = await window.apiJson('/api/spotify/host/status?t=' + Date.now()).catch(function () { return null; });
      return host && host.alive ? remoteHostStateToSdkState(host) : null;
    }
    var player = spotifyDirectState.sdkPlayer;
    if (!player || typeof player.getCurrentState !== 'function') return null;
    return player.getCurrentState().catch(function () { return null; });
  }

  async function confirmSpotifySeek(targetMs, serial, timeoutMs) {
    var started = Date.now();
    timeoutMs = Math.max(1800, Number(timeoutMs) || 6200);
    while (Date.now() - started < timeoutMs) {
      if (serial !== spotifyDirectState.seekSerial || !isSpotifyActive()) return null;
      var state = await readSpotifySeekState();
      var uri = sdkTrackUri(state);
      var position = Number(state && state.position || 0);
      var sameTrack = !spotifyDirectState.currentUri || !uri || uri === spotifyDirectState.currentUri;
      if (state && sameTrack && Math.abs(position - targetMs) <= 1800) return state;
      await spotifyDelay(120);
    }
    throw new Error('SPOTIFY_SEEK_NOT_CONFIRMED');
  }

  async function seekSpotifyDirect(seconds) {
    if (!isSpotifyActive()) return false;
    var durationMs = Math.max(0, Number(spotifyDirectState.durationMs || 0));
    var requestedMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    var positionMs = durationMs > 250 ? Math.min(requestedMs, durationMs - 120) : requestedMs;
    var serial = ++spotifyDirectState.seekSerial;
    spotifyDirectState.seeking = true;
    spotifyDirectState.seekTargetMs = positionMs;
    spotifyDirectState.seekStartedAt = Date.now();

    // Optimistic UI update, but do not synthesize playback advancement until
    // the SDK/host confirms the new position.
    spotifyDirectState.positionMs = positionMs;
    spotifyDirectState.updatedAt = Date.now();
    spotifyDirectState.clockUpdatedAt = monotonicNowMs();
    if (typeof window.updatePlaybackProgressUi === 'function') window.updatePlaybackProgressUi();
    if (typeof window.onPlaybackClockDiscontinuity === 'function') window.onPlaybackClockDiscontinuity(positionMs / 1000, 'spotify-seek-request');
    resetSpotifyVisualCursor(positionMs / 1000);
    resetSpotifyRealtimeDetector();

    try {
      if (spotifyDirectState.mode === 'sdk' && spotifyDirectState.sdkPlayer) {
        await spotifyDirectState.sdkPlayer.seek(positionMs);
      } else {
        await postJson('/api/spotify/player/seek', {
          deviceId: spotifyDirectState.deviceId,
          positionMs: positionMs
        });
      }
      var confirmedState = await confirmSpotifySeek(positionMs, serial, 6500);
      if (serial !== spotifyDirectState.seekSerial || !confirmedState) return false;
      spotifyDirectState.seeking = false;
      updateSpotifyState({
        currentUri: sdkTrackUri(confirmedState) || spotifyDirectState.currentUri,
        positionMs: Number(confirmedState.position || positionMs),
        durationMs: Number(confirmedState.duration || spotifyDirectState.durationMs || 0),
        isPlaying: confirmedState.paused !== true
      }, 'seek-confirmed');
      if (typeof window.onPlaybackClockDiscontinuity === 'function') window.onPlaybackClockDiscontinuity(Number(confirmedState.position || positionMs) / 1000, 'spotify-seek-confirmed');
      return true;
    } catch (error) {
      if (serial === spotifyDirectState.seekSerial) {
        spotifyDirectState.seeking = false;
        var latest = await readSpotifySeekState().catch(function () { return null; });
        if (latest) {
          updateSpotifyState({
            currentUri: sdkTrackUri(latest) || spotifyDirectState.currentUri,
            positionMs: Number(latest.position || spotifyDirectState.positionMs || 0),
            durationMs: Number(latest.duration || spotifyDirectState.durationMs || 0),
            isPlaying: latest.paused !== true
          }, 'seek-recovery');
        }
      }
      console.warn('[SpotifySeek]', error && (error.message || error));
      if (typeof window.showToast === 'function') {
        window.showToast(localized(
          'Spotify chưa xác nhận vị trí tua. Hãy thử lại một lần.',
          'Spotify did not confirm the seek position. Try once more.'
        ));
      }
      return false;
    }
  }

  function setSpotifyDirectVolume(value) {
    value = Math.max(0, Math.min(1, Number(value) || 0));
    if (spotifyDirectState.volumeTimer) clearTimeout(spotifyDirectState.volumeTimer);
    spotifyDirectState.volumeTimer = setTimeout(function () {
      if (usesRemoteSpotifyHost()) {
        postJson('/api/spotify/host/volume', { volume: value, volumePercent: Math.round(value * 100) })
          .catch(function (error) { console.warn('[SpotifyMasterVolume]', error); });
      } else if (spotifyDirectState.mode === 'sdk' && spotifyDirectState.sdkPlayer) {
        spotifyDirectState.sdkPlayer.setVolume(value).catch(function (error) { console.warn('[SpotifyVolume]', error); });
      }
    }, 45);
  }

  async function startSpotifyTrack(song, descriptor, opts, token) {
    var device = await resolveSpotifyDevice();
    if (token !== window.trackSwitchToken) return false;

    var selectedId = selectedSpotifyTrackId(song);
    var descriptorId = String(descriptor && (descriptor.spotifyId || descriptor.metadata && descriptor.metadata.spotifyId) || '');
    var targetUri = exactSpotifyTrackUri(song, descriptor);
    var targetId = spotifyTrackIdFromUri(targetUri);
    if (!selectedId || !targetUri || !targetId) throw new Error('SPOTIFY_TRACK_URI_REQUIRED');
    if (descriptorId && descriptorId !== selectedId && descriptorId !== targetId) {
      throw new Error('SPOTIFY_DESCRIPTOR_MISMATCH:' + selectedId + ':' + descriptorId);
    }

    var requestId = 'sy-' + Date.now().toString(36) + '-' + token + '-' + targetId.slice(-6);
    spotifyDirectState.active = true;
    spotifyDirectState.switchingTrack = true;
    spotifyDirectState.requestedUri = targetUri;
    spotifyDirectState.playRequestId = requestId;
    spotifyDirectState.wrongTrackSince = 0;
    window.activePlaybackTransport = 'spotify';
    spotifyDirectState.mode = 'sdk';
    spotifyDirectState.deviceId = device.id;
    spotifyDirectState.deviceName = device.name || 'Spotify';
    spotifyDirectState.currentUri = targetUri;
    spotifyDirectState.currentTrackId = targetId;
    spotifyDirectState.positionMs = Math.max(0, Math.round(Number(opts && opts.resumeAt || 0) * 1000));
    spotifyDirectState.durationMs = Number(song.duration || descriptor.metadata && descriptor.metadata.duration || 0);
    spotifyDirectState.updatedAt = Date.now();
    spotifyDirectState.clockUpdatedAt = monotonicNowMs();
    spotifyDirectState.endedHandledFor = '';

    window.playing = false;
    if (typeof window.setPlayIcon === 'function') window.setPlayIcon(false);

    if (window.audio) {
      try {
        window.audio.pause();
        window.audio.removeAttribute('src');
        window.audio.load();
      } catch (_) {}
    }

    spotifyDirectState.sdkPlaybackError = '';
    activateSpotifyAudioFromGesture();
    if (spotifyDirectState.sdkPlayer) await applySpotifySdkVolume(spotifyDirectState.sdkPlayer);

    var confirmedState = await playSpotifyUriExactly(
      device,
      targetUri,
      spotifyDirectState.positionMs,
      requestId
    );
    if (token !== window.trackSwitchToken) return false;

    var confirmedUri = sdkTrackUri(confirmedState);
    if (confirmedUri !== targetUri) {
      throw new Error('SPOTIFY_WRONG_TRACK:' + (confirmedUri || 'unknown'));
    }
    spotifyDirectState.switchingTrack = false;
    spotifyDirectState.requestedUri = targetUri;
    spotifyDirectState.wrongTrackSince = 0;

    updateSpotifyState({
      mode: device.mode,
      deviceId: device.id,
      deviceName: device.name,
      currentUri: targetUri,
      currentTrackId: targetId,
      positionMs: Number(confirmedState.position || spotifyDirectState.positionMs || 0),
      durationMs: Number(confirmedState.duration || spotifyDirectState.durationMs || 0),
      isPlaying: !confirmedState.paused
    }, 'start-confirmed');
    startSpotifyPolling();
    document.body.classList.add('spotify-direct-active');
    if (typeof window.hideBeatChip === 'function') window.hideBeatChip();
    if (typeof window.resetAudioVisualState === 'function') {
      try { window.resetAudioVisualState(); } catch (_) {}
    }
    resetSpotifyVisualCursor(Number(confirmedState.position || 0) / 1000);
    resetSpotifyRealtimeDetector();
    ensureSpotifyRealtimeCapture().catch(function () {});
    if (typeof window.showSourceFallbackNotice === 'function') {
      window.showSourceFallbackNotice(
        localized('Đang phát đúng bài đã chọn từ Spotify', 'Playing the selected Spotify track'),
        localized('ShinaYuu Music đã xác nhận Track ID trước khi cập nhật trạng thái phát.', 'ShinaYuu Music verified the Track ID before updating playback state.')
      );
    }
    if (typeof window.updatePlaybackQualityUi === 'function') window.updatePlaybackQualityUi();
    return true;
  }

  async function playSpotifyQueueAt(idx, opts) {
    opts = opts || {};
    if (!window.playQueue || idx < 0 || idx >= window.playQueue.length) return;
    // Call this synchronously from the user's click so Chromium treats the
    // loopback request as user-initiated. It remains silent and hidden.
    ensureSpotifyRealtimeCapture().catch(function () {});
    var phase = 'start';
    try {
      phase = 'session-finalize';
      try { window.finalizeListenSession(false); } catch (_) {}
      window.homeForcedOpen = false;
      if (!opts.preserveHomeState) window.homeSuppressed = false;
      window.currentIdx = idx;
      window.trackSwitchToken++;
      var token = window.trackSwitchToken;
      try { window.cancelBeatAnalysisTimer(); } catch (_) {}
      try { window.cancelBeatPrefetchTimer(); } catch (_) {}
      try { if (window.localBeatAnalysis && window.localBeatAnalysis.active) window.cancelLocalBeatAnalysis(); } catch (_) {}
      try { window.closeGsapModal(document.getElementById('local-beat-modal')); } catch (_) {}
      try { window.beatMapToken++; } catch (_) {}

      var song = typeof window.hydrateCustomCover === 'function' ? window.hydrateCustomCover(window.playQueue[idx]) : window.playQueue[idx];
      window.playQueue[idx] = song;
      var playbackContext = opts.context || song && song.radioContext || null;
      window.activeRadioContext = playbackContext;
      try { window.safeRenderQueuePanel('spotify-direct-switch', { scrollCurrent: window.miniQueueOpen }); } catch (_) {}
      try { window.suppressShelfPreviewForPlaybackSwitch(); } catch (_) {}
      // Do not pause the Spotify SDK before issuing the exact-track play
      // command. A pause command racing a Web API play command can leave the
      // previous Spotify item active. The exact URI command replaces it.
      if (typeof originalPauseForSwitch === 'function') originalPauseForSwitch();
      spotifyDirectState.switchingTrack = true;
      spotifyDirectState.requestedUri = '';
      spotifyDirectState.playRequestId = '';
      spotifyDirectState.wrongTrackSince = 0;
      stopSpotifyPolling();

      try { window.setDjModeActive(false, song); } catch (_) {}
      try { window.switchPlaybackVisualToEmily(); } catch (_) {}
      window.currentLocalSong = null;
      try { window.updateCustomCoverButton(); } catch (_) {}
      try { window.updateLikeButtons(song); } catch (_) {}
      try { window.syncLikeStatusForSong(song); } catch (_) {}
      try { window.resetCinemaTrackProfile(song); } catch (_) {}
      try { if (!opts.preserveHomeState) window.updateEmptyHomeVisibility(); } catch (_) {}

      var hint = document.getElementById('hint');
      if (hint) hint.classList.add('hidden');
      var title = document.getElementById('thumb-title');
      var artist = document.getElementById('thumb-artist');
      if (title) title.textContent = song.name || '';
      if (artist) artist.textContent = song.artist || '';
      try { window.updateControlTrackInfo(song); } catch (_) {}
      var thumb = document.getElementById('thumb-wrap');
      if (thumb) thumb.classList.add('visible');

      try {
        var initialLines = window.withLyricFallback([]);
        window.setOriginalLyricsState(initialLines, false, 'fallback');
        window.applyPreferredLyricsForCurrent(true);
      } catch (_) {}
      try {
        var customCover = window.getCustomCoverForSong(song);
        var coverOpts = { trackToken: token, deferHeavy: true, delay: 360, timeout: 1600 };
        if (customCover) window.applyCoverDataUrl(customCover, coverOpts);
        else window.loadCoverFromUrl(song.cover ? window.coverUrlWithSize(song.cover, 400) : '', coverOpts);
      } catch (_) {}
      var trial = document.getElementById('trial-banner');
      if (trial) trial.classList.remove('show');
      try { window.showLoading(); } catch (_) {}
      window.lyricSunEnergy = 0;
      window.lyricSunTarget = 0;
      window.lyricSunHold = 0;
      window.lyricSunAvg = 0;
      window.lyricSunPeak = 0.55;
      if (!window.firstPlayDone) {
        window.firstPlayDone = true;
        try { window.tweenParticleAlpha(window.uniforms.uAlpha.value || 0, 1, 220); } catch (_) {}
      }

      phase = 'descriptor';
      var requestedSpotifyId = selectedSpotifyTrackId(song);
      if (!requestedSpotifyId) throw new Error('SPOTIFY_TRACK_ID_REQUIRED');
      var descriptor = await window.apiJson('/api/song/url?id=' + encodeURIComponent(requestedSpotifyId));
      if (token !== window.trackSwitchToken) return;
      if (!descriptor || descriptor.transport !== 'spotify' || descriptor.playable === false || !descriptor.spotifyUri) {
        try { window.handlePlaybackUnavailable(song, descriptor || {}); } catch (_) {}
        if (descriptor && descriptor.reason === 'reauthorization_required') {
          if (typeof window.showSourceFallbackNotice === 'function') {
            window.showSourceFallbackNotice(
              localized('Cần kết nối lại Spotify', 'Spotify reconnection required'),
              localized('Hãy ngắt kết nối rồi đăng nhập lại để cấp quyền phát trực tiếp.', 'Disconnect and reconnect Spotify to grant direct playback permissions.')
            );
          }
        }
        return;
      }
      if (descriptor.metadata) Object.assign(song, descriptor.metadata);
      phase = 'spotify-start';
      var started = await startSpotifyTrack(song, descriptor, opts, token);
      if (!started || token !== window.trackSwitchToken) return;

      try { window.beginListenSession(song, playbackContext); } catch (_) {}
      if (song.type === 'podcast') {
        try {
          var podcastLines = window.withLyricFallback([]);
          window.setOriginalLyricsState(podcastLines, false, 'fallback');
          window.applyPreferredLyricsForCurrent(true);
        } catch (_) {}
      } else {
        try { window.fetchLyric(song, token); } catch (_) {}
      }
      try { window.safeRenderQueuePanel('spotify-direct-play', { scrollCurrent: window.miniQueueOpen }); } catch (_) {}
      try { window.scheduleShelfRebuild('spotify-direct-play', true); } catch (_) {}
      try { window.suppressShelfPreviewForPlaybackSwitch(); } catch (_) {}
      try { window.forcePlaybackControlsInteractive(); } catch (_) {}
      try { window.hideLoading(); } catch (_) {}
    } catch (error) {
      console.error('[SpotifyDirect]', phase, error);
      spotifyDirectState.active = false;
      spotifyDirectState.switchingTrack = false;
      spotifyDirectState.requestedUri = '';
      window.activePlaybackTransport = 'none';
      window.playing = false;
      try { window.setPlayIcon(false); } catch (_) {}
      try { window.hideLoading(); } catch (_) {}
      try { window.forcePlaybackControlsInteractive(); } catch (_) {}
      if (typeof window.showSourceFallbackNotice === 'function') {
        window.showSourceFallbackNotice(
          localized('Không thể phát từ Spotify', 'Spotify playback failed'),
          playerErrorMessage(error)
        );
      }
    }
  }

  window.playQueueAt = async function (idx, opts) {
    var song = window.playQueue && idx >= 0 ? window.playQueue[idx] : null;
    if (isSpotifySong(song)) return playSpotifyQueueAt(idx, opts);
    if (isSpotifyActive()) await pauseSpotifyDirect(true);
    spotifyDirectState.active = false;
    stopSpotifyPolling();
    stopSpotifyRealtimeCapture();
    document.body.classList.remove('spotify-direct-active');
    window.activePlaybackTransport = 'html-audio';
    return originalPlayQueueAt.call(window, idx, opts);
  };

  window.togglePlay = async function () {
    if (!isSpotifyActive()) return originalTogglePlay.apply(window, arguments);
    if (window.playToggleBusy) return;
    window.playToggleBusy = true;
    try {
      if (spotifyDirectState.isPlaying) await pauseSpotifyDirect(false);
      else await resumeSpotifyDirect();
    } finally {
      window.playToggleBusy = false;
      try { window.forcePlaybackControlsInteractive(); } catch (_) {}
    }
  };

  window.setVolume = function (value, silent) {
    originalSetVolume.call(window, value, silent);
    setSpotifyDirectVolume(window.targetVolume);
  };

  window.getPlaybackDurationSeconds = function () {
    if (isSpotifyActive()) {
      var duration = Number(spotifyDirectState.durationMs || 0) / 1000;
      if (duration > 0) return duration;
      var song = currentSong();
      return song ? Math.max(0, Number(song.duration || 0) / (Number(song.duration || 0) > 10000 ? 1000 : 1)) : 0;
    }
    return originalGetDuration.apply(window, arguments);
  };

  window.getPlaybackCurrentSeconds = function () {
    if (isSpotifyActive()) return nowPositionMs() / 1000;
    return originalGetCurrent.apply(window, arguments);
  };

  window.seekFromProgressPointer = function (event, emitParticles, commit) {
    if (!isSpotifyActive()) return originalSeekFromPointer.apply(window, arguments);
    var duration = window.getPlaybackDurationSeconds();
    if (!duration) return;
    var bar = document.getElementById('progress-bar');
    if (!bar) return;
    var rect = bar.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    var targetSec = ratio * duration;
    if (window.progressDragState) window.progressDragState.previewSec = targetSec;
    if (typeof window.setProgressVisual === 'function') window.setProgressVisual(ratio * 100);
    if (typeof window.updatePlaybackProgressUi === 'function') window.updatePlaybackProgressUi();
    if (emitParticles && typeof window.emitProgressDragParticles === 'function') {
      window.emitProgressDragParticles(event.clientX, rect.top + rect.height / 2);
    }
    // Pointer move only previews. Send exactly one Spotify seek on pointerup.
    if (commit) seekSpotifyDirect(targetSec);
  };

  window.pauseCurrentAudioForTrackSwitch = function () {
    if (isSpotifyActive()) pauseSpotifyDirect(true);
    return originalPauseForSwitch.apply(window, arguments);
  };

  window.syncPlaybackStateFromAudioEvent = function (reason) {
    if (isSpotifyActive()) return;
    window.activePlaybackTransport = window.audio && window.audio.src ? 'html-audio' : 'none';
    return originalSyncFromAudio.apply(window, arguments);
  };

  window.canReloadCurrentTrackForQuality = function () {
    if (isSpotifyActive() || isSpotifySong(currentSong())) return false;
    return originalCanReloadForQuality.apply(window, arguments);
  };

  window.updatePlaybackQualityUi = function () {
    originalUpdateQualityUi.apply(window, arguments);
    if (!isSpotifyActive()) return;
    var label = document.getElementById('quality-btn-label');
    var button = document.getElementById('quality-btn');
    if (label) label.textContent = 'SP';
    if (button) button.title = localized('Chất lượng do Spotify quản lý', 'Quality is managed by Spotify');
    document.querySelectorAll('.quality-option').forEach(function (option) {
      option.disabled = true;
      option.classList.add('locked');
      option.title = localized('Spotify quản lý chất lượng phát', 'Spotify manages playback quality');
    });
  };


  function resetSpotifyVisualCursor(positionSec) {
    spotifyDirectState.visualLastPositionSec = Math.max(0, Number(positionSec) || 0);
    spotifyDirectState.visualPulse = 0;
    resetSpotifyRealtimeDetector();
  }

  window.applySpotifyAmbientFrame = function (dt) {
    if (!isSpotifyActive()) return false;
    dt = Math.max(0.001, Math.min(0.08, Number(dt) || 0.016));

    if (spotifyDirectState.isPlaying
        && (spotifyRealtimeAudio.status === 'idle' || spotifyRealtimeAudio.status === 'error')) {
      ensureSpotifyRealtimeCapture().catch(function () {});
    }

    if (spotifyDirectState.isPlaying && processSpotifyRealtimeFrame(dt)) {
      spotifyDirectState.visualLastPositionSec = window.getPlaybackCurrentSeconds();
      return true;
    }

    // Never manufacture a BPM, beat grid, sine pulse, or timeline-derived
    // flash. If real PCM is unavailable, smoothly return the scene to idle.
    spotifyDirectState.visualPulse *= Math.pow(0.08, dt);
    window.beatOnsetFlag = false;
    window.beatPulse = realtimeFollow(Number(window.beatPulse) || 0, 0, dt, 0.04, 0.10);
    window.smoothBass = realtimeFollow(Number(window.smoothBass) || 0, 0, dt, 0.04, 0.13);
    window.smoothMid = realtimeFollow(Number(window.smoothMid) || 0, 0, dt, 0.05, 0.16);
    window.smoothTreb = realtimeFollow(Number(window.smoothTreb) || 0, 0, dt, 0.05, 0.16);
    window.smoothEnergy = realtimeFollow(Number(window.smoothEnergy) || 0, 0, dt, 0.05, 0.18);
    window.lyricSunTarget = 0;
    window.lyricSunEnergy = realtimeFollow(Number(window.lyricSunEnergy) || 0, 0, dt, 0.06, 0.20);
    spotifyDirectState.visualLastPositionSec = window.getPlaybackCurrentSeconds();
    return true;
  };

  document.addEventListener('pointerdown', function () {
    if (spotifyDirectState.sdkPlayer) activateSpotifyAudioFromGesture();
    else prewarmSpotifyDirectPlayer();
    if (isSpotifyActive()) ensureSpotifyRealtimeCapture().catch(function () {});
  }, true);
  document.addEventListener('keydown', function () {
    if (spotifyDirectState.sdkPlayer) activateSpotifyAudioFromGesture();
  }, true);
  window.addEventListener('shinayuu-native-runtime-ready', function () {
    setTimeout(prewarmSpotifyDirectPlayer, 350);
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(prewarmSpotifyDirectPlayer, 1200); }, { once: true });
  } else {
    setTimeout(prewarmSpotifyDirectPlayer, 1200);
  }
  window.prewarmSpotifyDirectPlayer = prewarmSpotifyDirectPlayer;
  setTimeout(function () { setSpotifyDirectVolume(targetSpotifyVolume()); }, 450);

  window.addEventListener('beforeunload', function () {
    stopSpotifyPolling();
    stopSpotifyRealtimeCapture();
    if (spotifyDirectState.sdkPlayer) {
      try { spotifyDirectState.sdkPlayer.disconnect(); } catch (_) {}
    }
  });
})();
