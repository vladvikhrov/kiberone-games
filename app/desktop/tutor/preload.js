'use strict';
/* Мост окна тьютора. Окно видит только эти функции, ни ipcRenderer, ни Node ему не достаются. */
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('k1t', Object.freeze({
  state: () => call('state.get'),
  createSchool: (name, password, again) => call('school.create', String(name), String(password), String(again)),
  restoreSchool: () => call('school.restore'),
  unlock: (password) => call('school.unlock', String(password)),
  recover: (code, password, again) => call('school.recover', String(code), String(password), String(again)),
  lock: () => call('school.lock'),
  backup: () => call('school.backup'),
  saveSchoolFile: () => call('school.saveFile'),
  pickGame: () => call('game.pick'),
  publish: (token, confirmUnknown, confirmReplace, trustName) => call('game.publish', String(token), confirmUnknown === true, confirmReplace === true, String(trustName)),
  cancel: (token) => call('game.cancel', String(token)),
  tryGame: (kind, value, mode) => call('game.try', String(kind), String(value), String(mode)),
  unpublish: (id) => call('game.unpublish', String(id)),
  setLesson: (id, value) => call('game.lesson', String(id), value === true),
  startServer: (name) => call('server.start', String(name)),
  stopServer: () => call('server.stop'),
  setFast: (fast) => call('server.fast', fast === true),
  saveRatings: () => call('ratings.saveSnapshot'),
  onLocked: (callback) => {
    ipcRenderer.removeAllListeners('school.locked');
    ipcRenderer.on('school.locked', () => callback());
  },
}));
