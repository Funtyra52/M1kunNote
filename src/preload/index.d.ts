import { ElectronAPI } from '@electron-toolkit/preload'

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  children?: FileEntry[]
}

export interface WorkspaceFolder {
  path: string
  name: string
  tree: FileEntry[]
}

export interface CustomAPI {
  selectFolder: () => Promise<WorkspaceFolder | null>
  refreshFolder: (folderPath: string) => Promise<FileEntry[] | null>
  readFile: (filePath: string) => Promise<string>
  writeFile: (filePath: string, content: string) => Promise<boolean>
  createFile: (parentPath: string, name: string) => Promise<FileEntry>
  createFolder: (parentPath: string, name: string) => Promise<FileEntry>
  deletePath: (targetPath: string) => Promise<boolean>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CustomAPI
  }
}
