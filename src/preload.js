'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  saveBackground: (srcPath) => ipcRenderer.invoke('bg:save', srcPath),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),

  // 媒體：必要時下載並快取，回傳本地檔 URL（無廣告、流暢）
  ensureMedia: (url, kind, quality) => ipcRenderer.invoke('media:ensure', { url, kind, quality }),
  mediaStatus: (url, kind, quality) => ipcRenderer.invoke('media:status', { url, kind, quality }),
  onMediaProgress: (cb) => ipcRenderer.on('media:progress', (_e, d) => cb(d)),
  cacheSize: () => ipcRenderer.invoke('cache:size'),
  cleanCache: (keepDays) => ipcRenderer.invoke('cache:clean', keepDays),

  updateYtDlp: () => ipcRenderer.invoke('ytdlp:update'),
  ytDlpVersion: () => ipcRenderer.invoke('ytdlp:version'),

  // App 自動更新
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkAppUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  downloadAppUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
  quitAndInstall: () => ipcRenderer.invoke('app:quitAndInstall'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, d) => cb(d)),
  onNewVersion: (cb) => ipcRenderer.on('app:new-version', (_e, d) => cb(d)),
  onUpdateNone: (cb) => ipcRenderer.on('update:none', (_e, d) => cb(d)),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, d) => cb(d)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, d) => cb(d)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, d) => cb(d)),

  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  scheduleToday: (url) => ipcRenderer.invoke('schedule:today', url),
  utmostToday: () => ipcRenderer.invoke('utmost:today'),
  biblePassage: (ref) => ipcRenderer.invoke('bible:passage', ref),
  setWindowMode: (mode) => ipcRenderer.invoke('win:mode', mode),
  minimizeWindow: () => ipcRenderer.invoke('win:minimize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } }
});
