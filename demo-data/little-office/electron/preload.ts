import { contextBridge, ipcRenderer } from 'electron';
import type { Command, Snapshot, OfficeBridge } from '../src/shared/types';

const bridge: OfficeBridge = {
  command: (command: Command) => ipcRenderer.invoke('office:command', command),
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => listener(snapshot);
    ipcRenderer.on('office:snapshot', receive);
    return () => ipcRenderer.removeListener('office:snapshot', receive);
  },
  openArtifact: (id) => ipcRenderer.invoke('office:artifact', id),
  openExternal: (url) => ipcRenderer.invoke('office:external', url),
  platform: process.platform,
};
contextBridge.exposeInMainWorld('office', bridge);
