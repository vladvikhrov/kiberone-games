'use strict';
/* Мост окна витрины. Окно видит только эти функции, ни ipcRenderer, ни Node ему не достаются. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('k1', Object.freeze({
  catalogList: () => ipcRenderer.invoke('catalog.list'),
  launch: (id, mode) => ipcRenderer.invoke('game.launch', String(id), String(mode)),
  vote: (id, mode, value) => ipcRenderer.invoke('vote.send', String(id), String(mode), Number(value)),
  setAddress: (ip) => ipcRenderer.invoke('server.setAddress', String(ip)),
  onCatalogChanged: (callback) => {
    ipcRenderer.removeAllListeners('catalog.changed');
    ipcRenderer.on('catalog.changed', () => callback());
  },
  onGameClosed: (callback) => {
    ipcRenderer.removeAllListeners('game.closed');
    ipcRenderer.on('game.closed', (_event, data) => callback({ id: String(data && data.id), mode: String(data && data.mode) }));
  },
}));
