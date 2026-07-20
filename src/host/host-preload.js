'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostApi', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('presence:state'),
  pair: (settings) => ipcRenderer.invoke('presence:pair', settings),
  unpair: () => ipcRenderer.invoke('presence:unpair'),
  refresh: () => ipcRenderer.invoke('presence:refresh'),
  saveAssignments: (assignments) => ipcRenderer.invoke('presence:assignments', assignments),
  utmostToday: () => ipcRenderer.invoke('host:utmost-today'),
  scriptureCurrent: () => ipcRenderer.invoke('host:scripture-current'),
  close: () => ipcRenderer.invoke('host:close'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('presence:state', listener);
    return () => ipcRenderer.removeListener('presence:state', listener);
  },
  onScriptureCurrent: (callback) => {
    const listener = (_event, scripture) => callback(scripture);
    ipcRenderer.on('host:scripture-current', listener);
    return () => ipcRenderer.removeListener('host:scripture-current', listener);
  }
});
