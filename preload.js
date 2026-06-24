const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  sfl3: {
    list: () => ipcRenderer.invoke('sfl3:list'),
    read: (p) => ipcRenderer.invoke('sfl3:read', p)
  }
})
