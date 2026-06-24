const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const SFL3_APP_DIR = path.join(
  app.getPath('appData'),
  'com.apple.sharedfilelist',
  'com.apple.LSSharedFileList.ApplicationRecentDocuments'
)

function readSfl3(sfl3Path) {
  return new Promise((resolve, reject) => {
    const [cmd, args] = app.isPackaged
      ? [path.join(process.resourcesPath, 'sfl3reader'), [sfl3Path]]
      : ['swift', [path.join(__dirname, 'sfl3reader.swift'), sfl3Path]]

    const proc = spawn(cmd, args)
    const chunks = []
    proc.stdout.on('data', d => chunks.push(d))
    proc.stderr.on('data', d => console.error('[sfl3]', d.toString()))
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`sfl3reader exited ${code}`))
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
      catch (e) { reject(e) }
    })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 680,
    height: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile('index.html')
}

app.whenReady().then(createWindow)

ipcMain.handle('sfl3:read', (_event, sfl3Path) => readSfl3(sfl3Path))

ipcMain.handle('sfl3:list', () => {
  const files = fs.readdirSync(SFL3_APP_DIR).filter(f => f.endsWith('.sfl3'))
  return files.map(f => ({
    bundleId: f.replace(/\.sfl3$/, ''),
    path: path.join(SFL3_APP_DIR, f)
  }))
})
