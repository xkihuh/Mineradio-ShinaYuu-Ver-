'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const chokidar = require('chokidar');
const Seven = require('node-7z');
const sevenBin = require('7zip-bin');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.opus', '.m4a', '.aac', '.wma', '.webm']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z']);
const LYRIC_EXTENSIONS = ['.yrc', '.lrc', '.txt'];
const STATE_VERSION = 1;

function sha1(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function safeName(value, fallback = 'Local Music') {
  const text = String(value || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 120);
}

function normalizeFsPath(value) {
  return path.resolve(String(value || '')).replace(/[\\/]+$/, '');
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function pathExists(target) {
  try { await fsp.access(target); return true; } catch (_) { return false; }
}

async function walkAudioFiles(root, output = []) {
  let entries = [];
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch (_) { return output; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkAudioFiles(full, output);
    } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      output.push(full);
    }
  }
  return output;
}

function ensureSevenZipExecutable() {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(sevenBin.path7za, 0o755); } catch (_) {}
}

function runSevenExtract(archivePath, outputDir) {
  ensureSevenZipExecutable();
  return new Promise((resolve, reject) => {
    const stream = Seven.extractFull(archivePath, outputDir, {
      $bin: sevenBin.path7za,
      overwrite: 'a',
      recursive: true,
    });
    let settled = false;
    stream.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });
}

class LocalLibrary extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dataDir = path.resolve(options.dataDir || process.env.SHINAYUU_DATA_DIR || path.join(__dirname, '.data'));
    this.stateFile = path.join(this.dataDir, 'local-library.json');
    this.cacheRoot = path.join(this.dataDir, 'local-library-cache');
    this.archiveRoot = path.join(this.cacheRoot, 'archives');
    this.coverRoot = path.join(this.cacheRoot, 'covers');
    this.sources = [];
    this.tracks = new Map();
    this.watchers = new Map();
    this.refreshTimers = new Map();
    this.initialized = false;
    this.initializing = null;
    this.revision = 0;
    this.lastError = '';
    this.changeTimer = null;
  }


  notifyChanged(reason = 'updated') {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.emit('changed', { reason, ...this.getState() });
    }, 90);
    this.changeTimer.unref?.();
  }

  async init() {
    if (this.initialized) return this.getState();
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      await ensureDir(this.archiveRoot);
      await ensureDir(this.coverRoot);
      let stored = null;
      try { stored = JSON.parse(await fsp.readFile(this.stateFile, 'utf8')); } catch (_) {}
      this.sources = Array.isArray(stored && stored.sources)
        ? stored.sources.map((source) => this.normalizeSource(source)).filter(Boolean)
        : [];
      await this.refreshAll({ persist: false });
      this.sources.forEach((source) => this.watchSource(source));
      this.initialized = true;
      return this.getState();
    })().finally(() => { this.initializing = null; });
    return this.initializing;
  }

  normalizeSource(source) {
    if (!source || !source.path) return null;
    const target = normalizeFsPath(source.path);
    const ext = path.extname(target).toLowerCase();
    const type = source.type === 'archive' || ARCHIVE_EXTENSIONS.has(ext) ? 'archive' : 'folder';
    return {
      id: String(source.id || sha1(`${type}:${target.toLowerCase()}`)),
      type,
      path: target,
      label: safeName(source.label || path.basename(target)),
      extractDir: type === 'archive' ? path.join(this.archiveRoot, String(source.id || sha1(`archive:${target.toLowerCase()}`))) : '',
      addedAt: Number(source.addedAt || Date.now()),
      updatedAt: Number(source.updatedAt || 0),
      trackCount: Number(source.trackCount || 0),
      error: '',
    };
  }

  async saveState() {
    await ensureDir(path.dirname(this.stateFile));
    const payload = {
      version: STATE_VERSION,
      revision: this.revision,
      sources: this.sources.map((source) => ({
        id: source.id,
        type: source.type,
        path: source.path,
        label: source.label,
        addedAt: source.addedAt,
        updatedAt: source.updatedAt,
        trackCount: source.trackCount,
      })),
    };
    const temp = `${this.stateFile}.${process.pid}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(payload, null, 2), 'utf8');
    try { await fsp.rename(temp, this.stateFile); }
    catch (_) { await fsp.copyFile(temp, this.stateFile); await fsp.unlink(temp).catch(() => {}); }
  }

  async addPaths(paths) {
    await this.init();
    const added = [];
    for (const raw of Array.isArray(paths) ? paths : []) {
      const target = normalizeFsPath(raw);
      let stat;
      try { stat = await fsp.stat(target); } catch (_) { continue; }
      const ext = path.extname(target).toLowerCase();
      const type = stat.isDirectory() ? 'folder' : (ARCHIVE_EXTENSIONS.has(ext) ? 'archive' : '');
      if (!type) continue;
      const existing = this.sources.find((item) => item.type === type && item.path.toLowerCase() === target.toLowerCase());
      if (existing) {
        await this.refreshSource(existing.id);
        added.push(existing);
        continue;
      }
      const source = this.normalizeSource({ type, path: target, label: path.basename(target), addedAt: Date.now() });
      this.sources.push(source);
      await this.refreshSource(source.id, { persist: false });
      this.watchSource(source);
      added.push(source);
    }
    this.revision += 1;
    await this.saveState();
    this.notifyChanged('source-added');
    return { ok: true, added: added.map((item) => this.publicSource(item)), ...this.getState() };
  }

  async removeSource(id) {
    await this.init();
    const index = this.sources.findIndex((source) => source.id === String(id || ''));
    if (index < 0) return { ok: false, error: 'LOCAL_SOURCE_NOT_FOUND', ...this.getState() };
    const [source] = this.sources.splice(index, 1);
    const watcher = this.watchers.get(source.id);
    if (watcher) await watcher.close().catch(() => {});
    this.watchers.delete(source.id);
    for (const [trackId, track] of this.tracks) {
      if (track.sourceId === source.id) this.tracks.delete(trackId);
    }
    if (source.type === 'archive' && source.extractDir && isInside(this.archiveRoot, source.extractDir)) {
      await fsp.rm(source.extractDir, { recursive: true, force: true }).catch(() => {});
    }
    this.revision += 1;
    await this.saveState();
    this.notifyChanged('source-removed');
    return { ok: true, removed: this.publicSource(source), ...this.getState() };
  }

  async refreshAll(options = {}) {
    for (const source of this.sources) await this.refreshSource(source.id, { persist: false });
    this.revision += 1;
    if (options.persist !== false) await this.saveState();
    this.notifyChanged('library-refreshed');
    return this.getState();
  }

  async refreshSource(id, options = {}) {
    const source = this.sources.find((item) => item.id === String(id || ''));
    if (!source) return null;
    source.error = '';
    try {
      if (!(await pathExists(source.path))) throw new Error('SOURCE_MISSING');
      let scanRoot = source.path;
      if (source.type === 'archive') {
        scanRoot = source.extractDir;
        await fsp.rm(scanRoot, { recursive: true, force: true });
        await ensureDir(scanRoot);
        await runSevenExtract(source.path, scanRoot);
      }
      const files = await walkAudioFiles(scanRoot, []);
      const nextTracks = [];
      for (const file of files) {
        if (!isInside(scanRoot, file)) continue;
        const track = await this.readTrack(file, source, scanRoot);
        if (track) nextTracks.push(track);
      }
      for (const [trackId, track] of this.tracks) {
        if (track.sourceId === source.id) this.tracks.delete(trackId);
      }
      nextTracks.forEach((track) => this.tracks.set(track.id, track));
      source.updatedAt = Date.now();
      source.trackCount = nextTracks.length;
    } catch (error) {
      source.error = String(error && (error.message || error) || 'LOCAL_SOURCE_SCAN_FAILED');
      this.lastError = source.error;
      console.warn('[LocalLibrary]', source.path, source.error);
    }
    this.revision += 1;
    if (options.persist !== false) await this.saveState();
    this.notifyChanged('source-refreshed');
    return source;
  }

  scheduleRefresh(sourceId, delay = 650) {
    const current = this.refreshTimers.get(sourceId);
    if (current) clearTimeout(current);
    const timer = setTimeout(() => {
      this.refreshTimers.delete(sourceId);
      this.refreshSource(sourceId).catch((error) => console.warn('[LocalLibrary] refresh failed:', error.message));
    }, delay);
    timer.unref?.();
    this.refreshTimers.set(sourceId, timer);
  }

  watchSource(source) {
    if (!source || this.watchers.has(source.id)) return;
    const watcher = chokidar.watch(source.path, {
      ignoreInitial: true,
      persistent: true,
      depth: source.type === 'folder' ? 12 : 0,
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 120 },
      ignored: /(^|[\\/])\../,
    });
    ['add', 'change', 'unlink', 'addDir', 'unlinkDir'].forEach((eventName) => {
      watcher.on(eventName, () => this.scheduleRefresh(source.id, source.type === 'archive' ? 1200 : 650));
    });
    watcher.on('error', (error) => {
      source.error = String(error && (error.message || error) || 'WATCH_FAILED');
    });
    this.watchers.set(source.id, watcher);
  }

  async readTrack(filePath, source, scanRoot) {
    let stat;
    try { stat = await fsp.stat(filePath); } catch (_) { return null; }
    const rel = path.relative(scanRoot, filePath).replace(/\\/g, '/');
    const id = sha1(`${source.id}:${rel.toLowerCase()}`);
    let metadata = null;
    try {
      const module = await import('music-metadata');
      metadata = await module.parseFile(filePath, { duration: true, skipCovers: false, skipPostHeaders: true });
    } catch (error) {
      console.warn('[LocalLibrary] metadata:', path.basename(filePath), error.message || error);
    }
    const common = metadata && metadata.common || {};
    const format = metadata && metadata.format || {};
    const fileBase = path.basename(filePath, path.extname(filePath));
    const title = safeName(common.title || fileBase, fileBase);
    const artist = safeName(common.artist || common.albumartist || 'Unknown Artist', 'Unknown Artist');
    const album = safeName(common.album || '', '');
    const duration = Number(format.duration || 0);
    let coverPath = '';
    const picture = Array.isArray(common.picture) && common.picture[0];
    if (picture && picture.data && picture.data.length) {
      const mime = String(picture.format || 'image/jpeg').toLowerCase();
      const ext = mime.includes('png') ? '.png' : (mime.includes('webp') ? '.webp' : '.jpg');
      coverPath = path.join(this.coverRoot, `${id}${ext}`);
      if (!(await pathExists(coverPath))) await fsp.writeFile(coverPath, picture.data).catch(() => {});
    }
    const baseNoExt = filePath.slice(0, -path.extname(filePath).length);
    let lyricPath = '';
    for (const ext of LYRIC_EXTENSIONS) {
      const candidate = `${baseNoExt}${ext}`;
      if (await pathExists(candidate)) { lyricPath = candidate; break; }
    }
    return {
      id,
      localId: id,
      sourceId: source.id,
      sourceType: source.type,
      sourceLabel: source.label,
      filePath,
      relativePath: rel,
      coverPath,
      lyricPath,
      name: title,
      title,
      artist,
      album,
      duration,
      durationMs: Math.round(duration * 1000),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      provider: 'local',
      realProvider: 'local',
      source: 'local',
      type: 'local',
      localKey: id,
      localFileId: id,
      localUrl: `/api/local/file?id=${encodeURIComponent(id)}`,
      audioUrl: `/api/local/file?id=${encodeURIComponent(id)}`,
      cover: coverPath ? `/api/local/cover?id=${encodeURIComponent(id)}&v=${Math.round(stat.mtimeMs)}` : '',
      playbackTransport: 'local',
      lyricsMetadataProvider: 'local',
    };
  }

  publicSource(source) {
    return {
      id: source.id,
      type: source.type,
      path: source.path,
      label: source.label,
      addedAt: source.addedAt,
      updatedAt: source.updatedAt,
      trackCount: source.trackCount,
      error: source.error || '',
    };
  }

  publicTrack(track) {
    const copy = { ...track };
    delete copy.filePath;
    delete copy.coverPath;
    delete copy.lyricPath;
    return copy;
  }

  getState() {
    const tracks = [...this.tracks.values()]
      .sort((a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name))
      .map((track) => this.publicTrack(track));
    const playlists = this.sources.map((source) => ({
      id: source.id,
      provider: 'local',
      source: 'local',
      name: source.label,
      creator: source.type === 'archive' ? 'Local archive' : 'Local folder',
      cover: tracks.find((track) => track.sourceId === source.id && track.cover)?.cover || '',
      trackCount: tracks.filter((track) => track.sourceId === source.id).length,
      localSourceType: source.type,
      localPath: source.path,
      error: source.error || '',
    }));
    return {
      ok: true,
      revision: this.revision,
      sources: this.sources.map((source) => this.publicSource(source)),
      playlists,
      tracks,
      trackCount: tracks.length,
      error: this.lastError || '',
    };
  }

  getPlaylist(id) {
    const sourceId = String(id || '').replace(/^local:/, '');
    const source = this.sources.find((item) => item.id === sourceId);
    if (!source) return { playlist: null, tracks: [] };
    const state = this.getState();
    return {
      playlist: state.playlists.find((item) => item.id === sourceId) || null,
      tracks: state.tracks.filter((track) => track.sourceId === sourceId),
    };
  }

  getTrack(id) {
    return this.tracks.get(String(id || '')) || null;
  }

  async getLyrics(id) {
    const track = this.getTrack(id);
    if (!track) return null;
    if (track.lyricPath) {
      const text = await fsp.readFile(track.lyricPath, 'utf8').catch(() => '');
      const ext = path.extname(track.lyricPath).toLowerCase();
      if (ext === '.yrc') return { lyric: '', yrc: text, plainLyric: '', source: 'local-sidecar-yrc' };
      if (ext === '.lrc') return { lyric: text, yrc: '', plainLyric: '', source: 'local-sidecar-lrc' };
      if (ext === '.txt') return { lyric: '', yrc: '', plainLyric: text, source: 'local-sidecar-text' };
    }
    return { lyric: '', yrc: '', plainLyric: '', source: 'local-metadata' };
  }

  async close() {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    for (const watcher of this.watchers.values()) await watcher.close().catch(() => {});
    this.watchers.clear();
  }
}

let singleton = null;
function getLocalLibrary() {
  if (!singleton) singleton = new LocalLibrary();
  return singleton;
}

module.exports = {
  AUDIO_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  LocalLibrary,
  getLocalLibrary,
};
