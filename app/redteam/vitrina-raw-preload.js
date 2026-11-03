'use strict';
/* Только для теста В9: отдаёт странице сырой ipcRenderer, как будто окно витрины взломано. В приложение не входит. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__raw', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
