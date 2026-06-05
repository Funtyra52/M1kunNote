import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as fs from 'fs'
import * as path from 'path'

interface FileEntry {
  name: string
  path: string
  isDir: boolean
  children?: FileEntry[]
}

function getDirectoryTree(dirPath: string): FileEntry[] {
  const result: FileEntry[] = []
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const file of files) {
      if (file.name.startsWith('.') || file.name === 'node_modules') continue
      const fullPath = path.join(dirPath, file.name)
      if (file.isDirectory()) {
        result.push({
          name: file.name,
          path: fullPath,
          isDir: true,
          children: getDirectoryTree(fullPath)
        })
      } else if (file.isFile() && (file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.json') || file.name.endsWith('.html'))) {
        result.push({
          name: file.name,
          path: fullPath,
          isDir: false
        })
      }
    }
  } catch (error) {
    console.error(error)
  }
  return result.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1
    if (!a.isDir && b.isDir) return 1
    return a.name.localeCompare(b.name)
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // IPC Handlers
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const folderPath = result.filePaths[0]
    return {
      path: folderPath,
      name: path.basename(folderPath),
      tree: getDirectoryTree(folderPath)
    }
  })

  ipcMain.handle('refresh-folder', async (_, folderPath: string) => {
    if (!fs.existsSync(folderPath)) return null
    return getDirectoryTree(folderPath)
  })

  ipcMain.handle('read-file', async (_, filePath: string) => {
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch (error) {
      console.error(error)
      throw error
    }
  })

  ipcMain.handle('write-file', async (_, filePath: string, content: string) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8')
      return true
    } catch (error) {
      console.error(error)
      throw error
    }
  })

  ipcMain.handle('create-file', async (_, parentPath: string, name: string) => {
    try {
      const filePath = path.join(parentPath, name)
      if (fs.existsSync(filePath)) {
        throw new Error('File already exists')
      }
      fs.writeFileSync(filePath, '', 'utf-8')
      return { name, path: filePath, isDir: false }
    } catch (error) {
      console.error(error)
      throw error
    }
  })

  ipcMain.handle('create-folder', async (_, parentPath: string, name: string) => {
    try {
      const folderPath = path.join(parentPath, name)
      if (fs.existsSync(folderPath)) {
        throw new Error('Folder already exists')
      }
      fs.mkdirSync(folderPath)
      return { name, path: folderPath, isDir: true, children: [] }
    } catch (error) {
      console.error(error)
      throw error
    }
  })

  ipcMain.handle('delete-path', async (_, targetPath: string) => {
    try {
      if (!fs.existsSync(targetPath)) return false
      const stat = fs.statSync(targetPath)
      if (stat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(targetPath)
      }
      return true
    } catch (error) {
      console.error(error)
      throw error
    }
  })



  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
