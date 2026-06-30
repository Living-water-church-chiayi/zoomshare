'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  saveBackground: (srcPath) => ipcRenderer.invoke('bg:save', srcPath),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),

  // 媒體：必要時下載並快取，回傳本地檔 URL（無廣告、流暢）
  ensureMedia: (url, kind, quality) => ipcRenderer.invoke('media:ensure', { url, kind, quality }),
  mediaStatus: (url, kind) => ipcRenderer.invoke('media:status', { url, kind }),
  onMediaProgress: (cb) => ipcRenderer.on('media:progress', (_e, d) => cb(d)),

  updateYtDlp: () => ipcRenderer.invoke('ytdlp:update'),
  ytDlpVersion: () => ipcRenderer.invoke('ytdlp:version'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  minimizeWindow: () => ipcRenderer.invoke('win:minimize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } }
});
