import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/types';
const api: DesktopAPI = {
  loadState: () => ipcRenderer.invoke('workspace:load'),
  saveState: (state) => ipcRenderer.invoke('workspace:save', state),
  selectFolder: () => ipcRenderer.invoke('folder:select'),
  exportDocument: (input) => ipcRenderer.invoke('document:export', input),
  getCloudSettings: () => ipcRenderer.invoke('cloud:settings'),
  configureCloud: (input) => ipcRenderer.invoke('cloud:configure', input),
  disconnectCloud: () => ipcRenderer.invoke('cloud:disconnect'),
  startSession: (input) => ipcRenderer.invoke('cloud:start', input),
  getSession: (id) => ipcRenderer.invoke('cloud:session', id),
  decideSession: (input) => ipcRenderer.invoke('cloud:decide', input),
};
contextBridge.exposeInMainWorld('ahq', api);
