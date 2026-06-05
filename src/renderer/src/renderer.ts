import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

// Определение типов, соответствующих index.d.ts
interface FileEntry {
  name: string
  path: string
  isDir: boolean
  children?: FileEntry[]
}

interface OpenTab {
  name: string
  path: string
  isUnsaved: boolean
}

// Состояние приложения
let workspacePath: string | null = null
let selectedFolderPath: string | null = null
let openTabs: OpenTab[] = []
let activeTabPath: string | null = null
const collapsedFolders = new Set<string>()

// Элементы DOM
const btnOpenFolder = document.getElementById('btnOpenFolder') as HTMLButtonElement
const btnNewFile = document.getElementById('btnNewFile') as HTMLButtonElement
const btnNewFolder = document.getElementById('btnNewFolder') as HTMLButtonElement
const btnRefreshFolder = document.getElementById('btnRefreshFolder') as HTMLButtonElement
const searchFilesInput = document.getElementById('searchFiles') as HTMLInputElement
const fileExplorerContainer = document.getElementById('fileExplorer') as HTMLDivElement
const tabsContainer = document.getElementById('tabsContainer') as HTMLDivElement
const btnViewEditor = document.getElementById('btnViewEditor') as HTMLButtonElement
const btnViewSplit = document.getElementById('btnViewSplit') as HTMLButtonElement
const btnViewPreview = document.getElementById('btnViewPreview') as HTMLButtonElement
const editorSplitArea = document.getElementById('editorSplitArea') as HTMLDivElement
const markdownEditor = document.getElementById('markdownEditor') as HTMLTextAreaElement
const markdownPreview = document.getElementById('markdownPreview') as HTMLDivElement
const filePathDisplay = document.getElementById('filePathDisplay') as HTMLSpanElement
const charCountSpan = document.getElementById('charCount') as HTMLSpanElement
const wordCountSpan = document.getElementById('wordCount') as HTMLSpanElement
const btnToggleTheme = document.getElementById('btnToggleTheme') as HTMLButtonElement
const btnSelectWorkspace = document.getElementById('btnSelectWorkspace') as HTMLButtonElement

// Элементы кастомного модального окна
const customModal = document.getElementById('customModal') as HTMLDivElement
const modalTitle = document.getElementById('modalTitle') as HTMLHeadingElement
const modalInput = document.getElementById('modalInput') as HTMLInputElement
const btnModalCancel = document.getElementById('btnModalCancel') as HTMLButtonElement
const btnModalConfirm = document.getElementById('btnModalConfirm') as HTMLButtonElement

let modalResolver: ((value: string | null) => void) | null = null

// Элементы модального окна справки
const helpModal = document.getElementById('helpModal') as HTMLDivElement
const btnHelp = document.getElementById('btnHelp') as HTMLButtonElement
const btnHelpClose = document.getElementById('btnHelpClose') as HTMLButtonElement

// Таймер автосохранения
let autoSaveTimeout: NodeJS.Timeout | null = null

// Вспомогательная функция дебаунса
function debounce<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  return function(...args: Parameters<T>): void {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      func(...args)
    }, wait)
  }
}

// Настройка кастомного рендерера для подсветки синтаксиса в Marked
const customRenderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(text, { language: lang }).value
        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`
      } catch (e) {
        console.error(e)
      }
    }
    // Экранирование спецсимволов HTML
    const escapedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
    return `<pre><code class="hljs">${escapedText}</code></pre>`
  }
}

// Настройка Marked
marked.use({
  gfm: true,
  breaks: true,
  renderer: customRenderer
})

// Инициализация приложения
function init(): void {
  // Загрузка сохранённой темы
  const savedTheme = localStorage.getItem('m1kun-theme') || 'theme-dark'
  document.body.className = savedTheme

  // Привязка обработчиков событий
  btnOpenFolder.addEventListener('click', selectWorkspace)
  btnSelectWorkspace?.addEventListener('click', selectWorkspace)
  btnRefreshFolder.addEventListener('click', refreshWorkspace)
  btnToggleTheme.addEventListener('click', toggleTheme)
  
  btnNewFile.addEventListener('click', handleCreateFile)
  btnNewFolder.addEventListener('click', handleCreateFolder)
  
  // Переключение режимов просмотра
  btnViewEditor.addEventListener('click', () => switchViewMode('editor'))
  btnViewSplit.addEventListener('click', () => switchViewMode('split'))
  btnViewPreview.addEventListener('click', () => switchViewMode('preview'))

  // Ввод текста в редакторе
  markdownEditor.addEventListener('input', handleEditorInput)

  // Перехват кликов по ссылкам в превью
  markdownPreview.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const link = target.closest('a')
    if (link && link.href) {
      const url = link.href
      if (url.startsWith('http://') || url.startsWith('https://')) {
        e.preventDefault()
        window.open(url)
      }
    }
  })
  
  // Кнопки форматирования панели инструментов
  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const format = (e.currentTarget as HTMLButtonElement).dataset.format
      if (format) applyFormat(format)
    })
  })
  
  // Поиск файлов
  searchFilesInput.addEventListener('input', handleSearch)

  // Горячие клавиши
  window.addEventListener('keydown', handleHotkeys)

  // Обработчики кастомного модального окна
  btnModalCancel.addEventListener('click', () => hideModal(null))
  btnModalConfirm.addEventListener('click', () => {
    const val = modalInput.value.trim()
    if (val) hideModal(val)
  })
  modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = modalInput.value.trim()
      if (val) hideModal(val)
    } else if (e.key === 'Escape') {
      hideModal(null)
    }
  })

  // Обработчики модального окна справки
  btnHelp.addEventListener('click', () => {
    helpModal.classList.remove('hidden')
  })
  btnHelpClose.addEventListener('click', () => {
    helpModal.classList.add('hidden')
  })

  // Блокировка редактора при отсутствии открытого файла
  updateEditorState()
}

// Смена темы оформления
function toggleTheme(): void {
  if (document.body.classList.contains('theme-dark')) {
    document.body.className = 'theme-light'
    localStorage.setItem('m1kun-theme', 'theme-light')
  } else {
    document.body.className = 'theme-dark'
    localStorage.setItem('m1kun-theme', 'theme-dark')
  }
}

// Переключение режимов отображения
function switchViewMode(mode: 'editor' | 'split' | 'preview'): void {
  btnViewEditor.classList.remove('active')
  btnViewSplit.classList.remove('active')
  btnViewPreview.classList.remove('active')

  editorSplitArea.className = 'split-area'

  if (mode === 'editor') {
    btnViewEditor.classList.add('active')
    editorSplitArea.classList.add('mode-editor')
  } else if (mode === 'split') {
    btnViewSplit.classList.add('active')
    editorSplitArea.classList.add('mode-split')
  } else if (mode === 'preview') {
    btnViewPreview.classList.add('active')
    editorSplitArea.classList.add('mode-preview')
  }
}

// Выбор рабочей папки
async function selectWorkspace(): Promise<void> {
  const folder = await window.api.selectFolder()
  if (folder) {
    workspacePath = folder.path
    selectedFolderPath = folder.path
    btnNewFile.disabled = false
    btnNewFolder.disabled = false
    btnRefreshFolder.disabled = false
    searchFilesInput.disabled = false
    
    renderExplorerTree(folder.tree)
  }
}

// Обновление дерева файлов
async function refreshWorkspace(): Promise<void> {
  if (!workspacePath) return
  const tree = await window.api.refreshFolder(workspacePath)
  if (tree) {
    renderExplorerTree(tree)
  }
}

// Поиск и фильтрация файлов в проводнике
function handleSearch(): void {
  const query = searchFilesInput.value.toLowerCase()
  const rows = fileExplorerContainer.querySelectorAll('.tree-row')
  rows.forEach(row => {
    const text = (row.querySelector('.node-name') as HTMLElement).innerText.toLowerCase()
    const isDir = (row as HTMLElement).dataset.isDir === 'true'
    if (isDir) return // Пропускаем папки, фильтруем только файлы
    
    const parentNode = row.closest('.tree-node') as HTMLElement
    if (text.includes(query)) {
      parentNode.style.display = 'block'
    } else {
      parentNode.style.display = 'none'
    }
  })
}

// Рендеринг дерева файлов
function renderExplorerTree(tree: FileEntry[]): void {
  fileExplorerContainer.innerHTML = ''
  if (tree.length === 0) {
    fileExplorerContainer.innerHTML = '<div class="empty-state"><p>Рабочая папка пуста.</p></div>'
    return
  }

  const treeRoot = buildTreeHTML(tree)
  fileExplorerContainer.appendChild(treeRoot)
}

function buildTreeHTML(nodes: FileEntry[]): HTMLElement {
  const container = document.createElement('div')
  container.className = 'tree-nodes-list'

  nodes.forEach(node => {
    const nodeEl = document.createElement('div')
    nodeEl.className = 'tree-node'

    const row = document.createElement('div')
    row.className = 'tree-row'
    row.dataset.path = node.path
    row.dataset.isDir = String(node.isDir)
    
    if (activeTabPath === node.path) {
      row.classList.add('active')
    }

    // Иконка стрелочки для папок
    let chevronHTML = ''
    if (node.isDir) {
      chevronHTML = `
        <span class="chevron">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7 10l5 5 5-5H7z"/></svg>
        </span>
      `
      if (collapsedFolders.has(node.path)) {
        row.classList.add('collapsed')
      }
    } else {
      chevronHTML = '<span class="chevron" style="opacity: 0;"></span>'
    }

    // Иконка типа элемента
    const iconHTML = node.isDir
      ? `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`

    row.innerHTML = `
      ${chevronHTML}
      <span class="node-icon">${iconHTML}</span>
      <span class="node-name">${node.name}</span>
      <div class="node-actions">
        <button class="icon-btn delete-btn" title="Удалить" data-path="${node.path}">
          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    `

    // Обработка клика по строке проводника
    row.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.closest('.delete-btn')) {
        const pathToDelete = (target.closest('.delete-btn') as HTMLElement).dataset.path
        if (pathToDelete) deleteWorkspacePath(pathToDelete)
        return
      }
      
      if (node.isDir) {
        selectedFolderPath = node.path
        
        if (collapsedFolders.has(node.path)) {
          collapsedFolders.delete(node.path)
          row.classList.remove('collapsed')
          row.nextElementSibling?.classList.remove('hidden')
        } else {
          collapsedFolders.add(node.path)
          row.classList.add('collapsed')
          row.nextElementSibling?.classList.add('hidden')
        }
      } else {
        selectedFolderPath = getParentPath(node.path)
        openFile(node.path, node.name)
      }
    })

    nodeEl.appendChild(row)

    // Рендеринг вложенных элементов для папок
    if (node.isDir && node.children) {
      const childrenContainer = buildTreeHTML(node.children)
      childrenContainer.className = 'tree-children'
      if (collapsedFolders.has(node.path)) {
        childrenContainer.classList.add('hidden')
      }
      nodeEl.appendChild(childrenContainer)
    }

    container.appendChild(nodeEl)
  })

  return container
}

// Открытие файла
async function openFile(filePath: string, fileName: string): Promise<void> {
  const existingTabIndex = openTabs.findIndex(t => t.path === filePath)
  if (existingTabIndex !== -1) {
    activeTabPath = filePath
  } else {
    openTabs.push({
      name: fileName,
      path: filePath,
      isUnsaved: false
    })
    activeTabPath = filePath
  }

  try {
    const content = await window.api.readFile(filePath)
    markdownEditor.value = content
    renderMarkdown(content)
    updateCounts(content)
  } catch (error) {
    console.error('Не удалось прочитать файл:', error)
  }

  updateEditorState()
  renderTabs()
  highlightActiveExplorerFile()
}

// Рендеринг вкладок (табов) открытых файлов
function renderTabs(): void {
  tabsContainer.innerHTML = ''
  openTabs.forEach((tab, index) => {
    const tabEl = document.createElement('div')
    tabEl.className = 'tab'
    if (tab.path === activeTabPath) tabEl.classList.add('active')
    if (tab.isUnsaved) tabEl.classList.add('unsaved')

    tabEl.innerHTML = `
      <span class="tab-name">${tab.name}</span>
      <span class="tab-close" data-index="${index}">✕</span>
    `

    tabEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.classList.contains('tab-close')) {
        e.stopPropagation()
        closeTab(index)
      } else {
        openFile(tab.path, tab.name)
      }
    })

    tabsContainer.appendChild(tabEl)
  })
}

// Закрытие вкладки
function closeTab(index: number): void {
  const closedTab = openTabs[index]
  if (closedTab.isUnsaved) {
    const saveConfirm = confirm(`Файл "${closedTab.name}" изменен. Сохранить изменения перед закрытием?`)
    if (saveConfirm) {
      saveActiveFile()
    }
  }

  openTabs.splice(index, 1)

  if (activeTabPath === closedTab.path) {
    if (openTabs.length > 0) {
      const nextTab = openTabs[Math.max(0, index - 1)]
      openFile(nextTab.path, nextTab.name)
    } else {
      activeTabPath = null
      markdownEditor.value = ''
      markdownPreview.innerHTML = ''
      updateCounts('')
      updateEditorState()
    }
  }

  renderTabs()
  highlightActiveExplorerFile()
}

// Обновление состояния доступности редактора
function updateEditorState(): void {
  const hasActiveFile = activeTabPath !== null
  markdownEditor.disabled = !hasActiveFile
  
  if (hasActiveFile) {
    filePathDisplay.innerText = activeTabPath || ''
  } else {
    filePathDisplay.innerText = 'Нет активного файла'
    markdownEditor.value = ''
    markdownPreview.innerHTML = ''
  }
}

// Подсветка открытого файла в проводнике
function highlightActiveExplorerFile(): void {
  const rows = fileExplorerContainer.querySelectorAll('.tree-row')
  rows.forEach(row => {
    if ((row as HTMLElement).dataset.path === activeTabPath) {
      row.classList.add('active')
    } else {
      row.classList.remove('active')
    }
  })
}

// Обработка ввода текста
function handleEditorInput(): void {
  const text = markdownEditor.value
  debouncedRenderMarkdown(text)
  updateCounts(text)

  if (activeTabPath) {
    const activeTab = openTabs.find(t => t.path === activeTabPath)
    if (activeTab && !activeTab.isUnsaved) {
      activeTab.isUnsaved = true
      renderTabs()
    }
    
    // Автосохранение (дебаунс 1 секунда)
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout)
    filePathDisplay.innerText = `${activeTabPath} (Сохраняется...)`
    autoSaveTimeout = setTimeout(() => {
      saveActiveFile()
    }, 1000)
  }
}

// Сохранение активного файла на диск
async function saveActiveFile(): Promise<void> {
  if (!activeTabPath) return
  const activeTab = openTabs.find(t => t.path === activeTabPath)
  if (!activeTab) return

  try {
    const content = markdownEditor.value
    await window.api.writeFile(activeTabPath, content)
    activeTab.isUnsaved = false
    renderTabs()
    filePathDisplay.innerText = activeTabPath
  } catch (error) {
    console.error('Ошибка сохранения:', error)
    filePathDisplay.innerText = `Ошибка сохранения: ${activeTabPath}`
  }
}

// Преобразование Markdown в HTML с санитацией
function renderMarkdown(text: string): void {
  const rawHtml = marked.parse(text) as string
  markdownPreview.innerHTML = DOMPurify.sanitize(rawHtml)
}

// Дебаунсированный рендеринг для редактора
const debouncedRenderMarkdown = debounce((text: string) => {
  renderMarkdown(text)
}, 200)

// Обновление счетчиков в футере
function updateCounts(text: string): void {
  charCountSpan.innerText = `${text.length} симв.`
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length
  wordCountSpan.innerText = `${words} слов`
}

// Вспомогательная функция получения пути родительской папки
function getParentPath(filePath: string): string {
  const index = filePath.lastIndexOf('\\')
  if (index === -1) {
    const index2 = filePath.lastIndexOf('/')
    if (index2 === -1) return workspacePath || ''
    return filePath.substring(0, index2)
  }
  return filePath.substring(0, index)
}

// Показ кастомного диалогового окна
function showModal(title: string, placeholder: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    modalTitle.innerText = title
    modalInput.placeholder = placeholder
    modalInput.value = defaultValue
    customModal.classList.remove('hidden')
    modalInput.focus()
    modalInput.select()
    
    modalResolver = resolve
  })
}

// Скрытие диалогового окна
function hideModal(value: string | null): void {
  customModal.classList.add('hidden')
  if (modalResolver) {
    modalResolver(value)
    modalResolver = null
  }
}

// Создание нового файла
async function handleCreateFile(): Promise<void> {
  const parent = selectedFolderPath || workspacePath
  if (!parent) return
  const filename = await showModal('Создать новый файл', 'например, заметка.md')
  if (!filename) return

  try {
    const newFile = await window.api.createFile(parent, filename)
    await refreshWorkspace()
    openFile(newFile.path, newFile.name)
  } catch (error: any) {
    alert(error.message || 'Не удалось создать файл')
  }
}

// Создание новой папки
async function handleCreateFolder(): Promise<void> {
  const parent = selectedFolderPath || workspacePath
  if (!parent) return
  const foldername = await showModal('Создать новую папку', 'Имя папки')
  if (!foldername) return

  try {
    await window.api.createFolder(parent, foldername)
    await refreshWorkspace()
  } catch (error: any) {
    alert(error.message || 'Не удалось создать папку')
  }
}

// Удаление файла или папки
async function deleteWorkspacePath(targetPath: string): Promise<void> {
  const confirmDelete = confirm(`Вы уверены, что хотите удалить этот элемент?\n${targetPath}`)
  if (!confirmDelete) return

  try {
    const success = await window.api.deletePath(targetPath)
    if (success) {
      const tabIndex = openTabs.findIndex(t => t.path === targetPath)
      if (tabIndex !== -1) {
        openTabs.splice(tabIndex, 1)
        if (activeTabPath === targetPath) {
          activeTabPath = null
          updateEditorState()
        }
        renderTabs()
      }
      await refreshWorkspace()
    }
  } catch (error) {
    alert('Не удалось удалить элемент')
  }
}

// Применение форматирования в редакторе
function applyFormat(format: string): void {
  const start = markdownEditor.selectionStart
  const end = markdownEditor.selectionEnd
  const text = markdownEditor.value
  const selectedText = text.substring(start, end)
  
  let replacement = ''
  let newCursorPos = start

  switch (format) {
    case 'bold':
      replacement = `**${selectedText || 'жирный текст'}**`
      newCursorPos = start + (selectedText ? replacement.length : 2)
      break
    case 'italic':
      replacement = `*${selectedText || 'курсив'}*`
      newCursorPos = start + (selectedText ? replacement.length : 1)
      break
    case 'heading':
      const lineStart = text.lastIndexOf('\n', start - 1) + 1
      replacement = '## ' + text.substring(lineStart, end)
      markdownEditor.setSelectionRange(lineStart, end)
      markdownEditor.focus()
      document.execCommand('insertText', false, replacement)
      handleEditorInput()
      return
    case 'code':
      replacement = `\`\`\`javascript\n${selectedText || '// код здесь'}\n\`\`\``
      newCursorPos = start + 13
      break
    case 'link':
      replacement = `[${selectedText || 'описание ссылки'}](https://example.com)`
      newCursorPos = start + 1
      break
    case 'image':
      replacement = `![${selectedText || 'Альтернативный текст'}](https://example.com/image.png)`
      newCursorPos = start + 2
      break
    case 'ul':
      replacement = `- ${selectedText || 'Элемент списка'}`
      break
    case 'ol':
      replacement = `1. ${selectedText || 'Элемент списка'}`
      break
    case 'quote':
      replacement = `> ${selectedText || 'Цитата'}`
      break
    case 'table':
      replacement = `\n| Колонка 1 | Колонка 2 |\n| --------- | --------- |\n| Элемент 1 | Элемент 2 |\n`
      break
  }

  markdownEditor.focus()
  document.execCommand('insertText', false, replacement)
  
  if (selectedText === '') {
    markdownEditor.setSelectionRange(newCursorPos, newCursorPos)
  }
  handleEditorInput()
}

// Горячие клавиши
function handleHotkeys(e: KeyboardEvent): void {
  // Закрытие справки по кнопке Escape
  if (e.key === 'Escape') {
    helpModal.classList.add('hidden')
  }

  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 's':
        e.preventDefault()
        saveActiveFile()
        break
      case 'b':
        e.preventDefault()
        applyFormat('bold')
        break
      case 'i':
        e.preventDefault()
        applyFormat('italic')
        break
      case 'h':
        e.preventDefault()
        applyFormat('heading')
        break
    }
  }
}

// Инициализация при загрузке DOM
window.addEventListener('DOMContentLoaded', init)
