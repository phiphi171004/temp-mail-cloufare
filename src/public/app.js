// Deobfuscated version of ob.js
// Removed anti-debugging code and renamed variables for readability

// ============================================
// DEBUG LOGGER - Tự động ẩn debugLog trên production
// ============================================
const IS_PRODUCTION = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
const debugLog = IS_PRODUCTION ? function () { } : console.log.bind(console)

const ENCRYPTION_KEY = 'ElQo98UA3C&3udC%O-Lt]ISaKv61:jMQ'
let ENCRYPTION_ENABLED = false

function generateDynamicEndpoint(endpoint) {
  const timestamp = Date.now()
  const randomStr = Math.random().toString(36).substring(2, 15)
  const combined = timestamp + '-' + randomStr + '-' + endpoint + '-' + ENCRYPTION_KEY

  let hash = 0
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }

  const hashStr = Math.abs(hash).toString(36) + Math.random().toString(36).substring(2, 10)
  return '/' + hashStr
}

async function deriveKeyFromSecret(secret) {
  const encoder = new TextEncoder()
  const paddedSecret = secret.padEnd(32, '0').substring(0, 32)
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(paddedSecret),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  )

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('temp-mail-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptPayload(payload) {
  const encoder = new TextEncoder()
  const jsonStr = JSON.stringify(payload)
  const data = encoder.encode(jsonStr)
  const key = await deriveKeyFromSecret(ENCRYPTION_KEY)
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128,
    },
    key,
    data
  )

  const encryptedArray = new Uint8Array(encrypted)
  const tag = encryptedArray.slice(-16)
  const ciphertext = encryptedArray.slice(0, -16)
  const result = new Uint8Array(iv.length + ciphertext.length + tag.length)

  result.set(iv)
  result.set(ciphertext, iv.length)
  result.set(tag, iv.length + ciphertext.length)

  return btoa(String.fromCharCode(...result))
}

async function decryptPayload(encryptedData) {
  const decoder = new TextDecoder()
  const data = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0))
  const iv = data.slice(0, 12)
  const tag = data.slice(-16)
  const ciphertext = data.slice(12, -16)

  const key = await deriveKeyFromSecret(ENCRYPTION_KEY)
  const combined = new Uint8Array(ciphertext.length + tag.length)
  combined.set(ciphertext)
  combined.set(tag, ciphertext.length)

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128,
    },
    key,
    combined
  )

  const decryptedStr = decoder.decode(decrypted)
  return JSON.parse(decryptedStr)
}

let SESSION_ID = localStorage.getItem('tempMailSessionId')
let isNewSession = false

if (!SESSION_ID) {
  SESSION_ID = 'web-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9)
  localStorage.setItem('tempMailSessionId', SESSION_ID)
  isNewSession = true
}

let currentEmail = null
let autoRefreshInterval = null
let iMailPollingInterval = null
let currentMessageCount = 0
let currentMessages = []
let viewingMessageIndex = null
let displayedMessageIds = new Set()
let moaktSessionExpiredHandled = false

// API Request Queue - để đảm bảo API calls chạy tuần tự
let apiQueue = []
let isProcessingQueue = false

// Debouncing cho refreshMessages
let refreshMessagesTimeout = null
let isRefreshingMessages = false

const API_BASE_URL = (() => {
  const hostname = window.location.hostname
  const port = window.location.port

  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return ''
  }

  if (port && port !== '3000') {
    return 'http://localhost:3000'
  }

  if (window.location.protocol === 'file:') {
    return 'http://localhost:3000'
  }

  return ''
})()

/**
 * Process HTML content to make all links open in new tab
 */
function processEmailHTML(html) {
  if (!html || typeof html !== 'string') {
    return html
  }

  // Create a temporary div to parse HTML
  const temp = document.createElement('div')
  temp.innerHTML = html

  // Find all <a> tags and add target="_blank" and rel="noopener noreferrer"
  const links = temp.querySelectorAll('a')
  links.forEach(link => {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  })

  return temp.innerHTML
}

const EMPTY_MESSAGE_HTML =
  '<p style="color: var(--gray); text-align: center; padding: 40px;">Không có nội dung</p>'

/**
 * Status / loading / error text inside detail pane (not email HTML)
 */
function setDetailStatus(html) {
  const detailContent = document.getElementById('detailContent')
  if (!detailContent) return
  detailContent.innerHTML = html
}

/**
 * Render email body isolated in sandboxed iframe so mobile/fixed
 * templates cannot break the desktop page layout.
 */
function setDetailEmailBody(html) {
  const detailContent = document.getElementById('detailContent')
  if (!detailContent) return

  const processed = processEmailHTML(html)
  if (!processed || (typeof processed === 'string' && !processed.trim())) {
    detailContent.innerHTML = EMPTY_MESSAGE_HTML
    return
  }

  if (globalThis.EmailRenderer && typeof EmailRenderer.render === 'function') {
    EmailRenderer.render(detailContent, processed)
    return
  }

  // Fallback: still contain overflow if renderer script failed to load
  detailContent.innerHTML =
    '<div class="email-html-fallback">' + processed + '</div>'
}

async function apiCall(endpoint, method = 'GET', payload = null) {
  if (!ENCRYPTION_ENABLED) {
    const url = API_BASE_URL ? API_BASE_URL + endpoint : endpoint
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': SESSION_ID,
      },
    }

    if (payload) {
      options.body = JSON.stringify(payload)
    }

    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        throw new Error('HTTP ' + response.status)
      }
      return await response.json()
    } catch (error) {
      throw error
    }
  }

  // Encryption enabled
  const dynamicEndpoint = generateDynamicEndpoint(endpoint)
  const url = API_BASE_URL ? API_BASE_URL + dynamicEndpoint : dynamicEndpoint

  const requestData = {
    real_endpoint: endpoint,
    method: method,
    payload: payload,
    timestamp: Date.now(),
    nonce: Math.random().toString(36).substring(2, 15),
  }

  const encrypted = await encryptPayload(requestData)
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': SESSION_ID,
    },
    body: JSON.stringify({ encrypted: encrypted }),
  }

  try {
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new Error('HTTP ' + response.status)
    }

    const result = await response.json()
    if (result.encrypted) {
      return await decryptPayload(result.encrypted)
    }
    return result
  } catch (error) {
    throw error
  }
}

// ============================================
// API REQUEST QUEUE
// ============================================
// Đảm bảo API calls chạy tuần tự, không đồng thời
async function queueApiCall(endpoint, method = 'GET', payload = null) {
  debugLog(`[API Queue] Adding: ${method} ${endpoint}`)
  debugLog(`[API Queue] Queue length: ${apiQueue.length}`)

  return new Promise((resolve, reject) => {
    apiQueue.push({ endpoint, method, payload, resolve, reject })
    processQueue()
  })
}

async function processQueue() {
  if (isProcessingQueue) {
    debugLog('[API Queue] Already processing, waiting...')
    return
  }

  if (apiQueue.length === 0) {
    return
  }

  debugLog(`[API Queue] Processing ${apiQueue.length} requests...`)
  isProcessingQueue = true

  while (apiQueue.length > 0) {
    const { endpoint, method, payload, resolve, reject } = apiQueue.shift()
    debugLog(`[API Queue] Executing: ${method} ${endpoint}`)

    try {
      const result = await apiCall(endpoint, method, payload)
      resolve(result)
      debugLog(`[API Queue] ✓ Success: ${method} ${endpoint}`)
    } catch (error) {
      reject(error)
      debugLog(`[API Queue] ✗ Error: ${method} ${endpoint}`, error)
    }

    // Đợi 100ms giữa các requests để tránh spam
    await new Promise(r => setTimeout(r, 100))
  }

  isProcessingQueue = false
  debugLog('[API Queue] Queue empty')
}

function showLoading(message = 'Đang xử lý...') {
  const overlay = document.getElementById('loadingOverlay')
  const text = document.getElementById('loadingText')
  text.textContent = message
  overlay.classList.add('show')
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay')
  overlay.classList.remove('show')
}

function setButtonLoading(button, loading = true) {
  if (loading) {
    button.classList.add('loading')
    button.disabled = true
  } else {
    button.classList.remove('loading')
    button.disabled = false
  }
}

function showSkeletonMessages(count = 3) {
  const messagesList = document.getElementById('messagesList')
  messagesList.innerHTML = ''

  for (let i = 0; i < count; i++) {
    const skeleton = document.createElement('div')
    skeleton.className = 'skeleton-message'
    skeleton.innerHTML = `
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
        `
    messagesList.appendChild(skeleton)
  }
}

const toastIcons = {
  success: 'fa-check-circle',
  error: 'fa-exclamation-circle',
  info: 'fa-info-circle',
  warning: 'fa-exclamation-triangle'
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer')

  // Giới hạn 5 toast cùng lúc
  while (container.children.length >= 5) {
    container.removeChild(container.firstChild)
  }

  const toast = document.createElement('div')
  toast.className = 'toast ' + type
  toast.innerHTML = `
        <i class="fas ${toastIcons[type]}"></i>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
    `
  container.appendChild(toast)

  // Auto hide sau 3s
  setTimeout(() => {
    toast.classList.add('hiding')
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast)
    }, 350)
  }, 3000)
}

async function init() {
  showLoading('Đang khởi tạo...')
  try {
    // Load enabled sources first (sẽ set dropdown value dựa trên defaultSource)
    await loadEnabledSources()

    // Lấy giá trị từ dropdown (đã được set bởi loadEnabledSources)
    const mailSourceSelect = document.getElementById('mailSource')
    const mailSource = mailSourceSelect ? mailSourceSelect.value : 'noopmail'

    await apiCall('/api/init', 'POST', { sourceId: mailSource })
    await loadDomains()

    const lastEmail = localStorage.getItem('tempMailLastEmail')
    if (lastEmail) {
      currentEmail = lastEmail
      updateEmailDisplay(lastEmail)
      showSkeletonMessages(3)

      try {
        const source = localStorage.getItem('mailSource') || 'noopmail'
        if (
          source === 'tmail' ||
          source === 'edumail' ||
          source === 'tempmail-id' ||
          source === 'noopmail' ||
          source === 'temporarymail' ||
          source === 'mailio' ||
          source === 'etempmail' ||
          source === 'priyo' ||
          source === 'pmail' ||
          source === 'tinyhost' ||
          source === 'apple' ||
          source === 'generatoremail' ||
          source === 'moakt' ||
          source === 'tempmailapi' ||
          source === 'inboxes'
        ) {
          const secretKey =
            source === 'temporarymail'
              ? localStorage.getItem('temporarymailSecretKey')
              : null
          const token =
            source === 'mailio'
              ? localStorage.getItem('mailioToken')
              : source === 'apple'
                ? localStorage.getItem('appleToken')
                : null
          const cookies =
            source === 'edumail'
              ? localStorage.getItem('edumailCookies')
              : null
          const tempmailapiPassword =
            source === 'tempmailapi'
              ? localStorage.getItem('tempmailapiPassword')
              : null

          await apiCall('/api/email/sync', 'POST', {
            email: lastEmail,
            secretKey: secretKey,
            token: token,
            cookies: cookies,
            tempmailapiPassword: tempmailapiPassword,
          })
        }
        await refreshMessages()
      } catch (error) {
        localStorage.removeItem('tempMailLastEmail')
        localStorage.removeItem('tempMailLastEmailTime')
        localStorage.removeItem('temporarymailSecretKey')
        localStorage.removeItem('mailioToken')
        localStorage.removeItem('edumailCookies')
        localStorage.removeItem('appleToken')
        localStorage.removeItem('tempmailapiPassword')
        currentEmail = null
        updateEmailDisplay(null)
        displayedMessageIds.clear()
        displayMessages([], true)

        try {
          const result = await apiCall('/api/email/random', 'POST')
          if (result.success) {
            currentEmail = result.email
            localStorage.setItem('tempMailLastEmail', result.email)
            localStorage.setItem('tempMailLastEmailTime', Date.now().toString())
            if (result.secretKey) {
              localStorage.setItem('temporarymailSecretKey', result.secretKey)
            }
            if (result.token) {
              localStorage.setItem('mailioToken', result.token)
            }
            if (result.cookies) {
              localStorage.setItem('edumailCookies', result.cookies)
            }
            if (result.password) {
              localStorage.setItem('tempmailapiPassword', result.password)
            }
            updateEmailDisplay(result.email)
            displayedMessageIds.clear()
            showSkeletonMessages(3)
            await refreshMessages()
            await startPollingIfIMail()
            showToast('✓ Đã tạo email mới!', 'success')
          } else {
            showToast(
              'Không thể tạo email mới: ' + (result.error || 'Lỗi không xác định'),
              'error'
            )
          }
        } catch (error) {
          showToast('Lỗi: ' + error.message, 'error')
        }
      }
      hideLoading()
      if (currentEmail) {
        showToast('Chào mừng bạn trở lại!', 'success')
      }
    } else {
      currentEmail = null
      updateEmailDisplay(null)
      displayedMessageIds.clear()
      displayMessages([], true)

      try {
        const result = await apiCall('/api/email/random', 'POST')
        if (result.success) {
          currentEmail = result.email
          localStorage.setItem('tempMailLastEmail', result.email)
          localStorage.setItem('tempMailLastEmailTime', Date.now().toString())
          if (result.secretKey) {
            localStorage.setItem('temporarymailSecretKey', result.secretKey)
          }
          if (result.token) {
            const source = localStorage.getItem('mailSource') || 'noopmail'
            if (source === 'mailio') {
              localStorage.setItem('mailioToken', result.token)
            } else if (source === 'apple') {
              localStorage.setItem('appleToken', result.token)
            }
          }
          if (result.cookies) {
            localStorage.setItem('edumailCookies', result.cookies)
          }
          if (result.password) {
            localStorage.setItem('tempmailapiPassword', result.password)
          }
          updateEmailDisplay(result.email)
          displayedMessageIds.clear()
          showSkeletonMessages(3)
          await refreshMessages()
          await startPollingIfIMail()
          showToast('✓ Email của bạn đã sẵn sàng!', 'success')
        } else {
          showToast(result.error || 'Không thể tạo email', 'error')
        }
      } catch (error) {
        showToast('Lỗi: ' + error.message, 'error')
      }
      hideLoading()
    }
    startAutoRefresh()
  } catch (error) {
    hideLoading()
    showToast('Lỗi khởi tạo: ' + error.message, 'error')
  }
}

async function switchMailSource() {
  const mailSourceSelect = document.getElementById('mailSource')
  const selectedSource = mailSourceSelect.value

  if (!selectedSource) {
    return
  }

  stopPollingIfIMail()
  showLoading('Đang chuyển nguồn mail...')

  try {
    const result = await apiCall('/api/source/switch', 'POST', {
      sourceId: selectedSource,
    })

    if (result.success) {
      localStorage.setItem('mailSource', selectedSource)
      await loadDomains()
      localStorage.removeItem('tempMailLastEmail')
      localStorage.removeItem('tempMailLastEmailTime')
      localStorage.removeItem('temporarymailSecretKey')
      localStorage.removeItem('mailioToken')
      localStorage.removeItem('edumailCookies')
      currentEmail = null
      updateEmailDisplay(null)
      displayedMessageIds.clear()
      displayMessages([], true)
      hideLoading()
      showToast('Đã chuyển sang: ' + result.source.name, 'success')

      showLoading('Đang tạo email mới...')
      try {
        const emailResult = await apiCall('/api/email/random', 'POST')
        if (emailResult.success) {
          currentEmail = emailResult.email
          localStorage.setItem('tempMailLastEmail', emailResult.email)
          localStorage.setItem('tempMailLastEmailTime', Date.now().toString())
          if (emailResult.secretKey) {
            localStorage.setItem('temporarymailSecretKey', emailResult.secretKey)
          }
          if (emailResult.token) {
            const source = localStorage.getItem('mailSource') || 'noopmail'
            if (source === 'mailio') {
              localStorage.setItem('mailioToken', emailResult.token)
            } else if (source === 'apple') {
              localStorage.setItem('appleToken', emailResult.token)
            }
          }
          if (emailResult.password) {
            localStorage.setItem('tempmailapiPassword', emailResult.password)
          }
          updateEmailDisplay(emailResult.email)
          displayedMessageIds.clear()
          showSkeletonMessages(3)
          await refreshMessages()

          const source = localStorage.getItem('mailSource') || 'noopmail'
          if (
            source === 'tempmail-id' ||
            source === 'noopmail' ||
            source === 'temporarymail' ||
            source === 'mailio'
          ) {
            await startPollingIfIMail()
          } else {
            startAutoRefresh()
          }
          showToast('✓ Email mới đã được tạo!', 'success')
        } else {
          showToast(emailResult.error || 'Không thể tạo email', 'error')
        }
      } catch (error) {
        showToast('Lỗi: ' + error.message, 'error')
      }
      hideLoading()
    } else {
      hideLoading()
      showToast(result.error || 'Lỗi chuyển nguồn mail', 'error')
      mailSourceSelect.value = localStorage.getItem('mailSource') || 'noopmail'
    }
  } catch (error) {
    hideLoading()
    showToast('Lỗi: ' + error.message, 'error')
    mailSourceSelect.value = localStorage.getItem('mailSource') || 'noopmail'
  }
}

async function loadDomains() {
  const result = await apiCall('/api/domains')
  const domainSelect = document.getElementById('domain')

  if (result.success) {
    if (result.domains && result.domains.length > 0) {
      domainSelect.innerHTML = result.domains
        .map((domain) => `<option value="${domain}">${domain}</option>`)
        .join('')
    } else {
      domainSelect.innerHTML = '<option value="">Không có domain</option>'
    }
    if (result.source) {
      // Source info available if needed
    }
  }
}

async function loadCurrentEmail() {
  const result = await apiCall('/api/email/current')
  if (result.success && result.email) {
    currentEmail = result.email
    updateEmailDisplay(result.email)
    await refreshMessages()
  }
}

function updateEmailDisplay(email) {
  const emailElement = document.getElementById('currentEmail')
  const copyBtn = document.getElementById('copyBtn')

  if (email) {
    emailElement.innerHTML = email
    emailElement.classList.remove('email-empty')
    copyBtn.style.display = 'flex'
  } else {
    emailElement.innerHTML = '<span class="email-empty">Chưa có email</span>'
    emailElement.classList.add('email-empty')
    copyBtn.style.display = 'none'
  }
}

async function openCreateModal() {
  const mailSource = localStorage.getItem('mailSource') || 'noopmail'
  const usernameGroup = document.getElementById('usernameGroup')
  const domainHelp = document.getElementById('domainHelp')

  if (mailSource === 'tempmail-id') {
    if (usernameGroup) {
      usernameGroup.style.display = 'block'
    }
    if (domainHelp) {
      domainHelp.style.display = 'block'
    }
  } else {
    if (usernameGroup) {
      usernameGroup.style.display = 'block'
    }
    if (domainHelp) {
      domainHelp.style.display = 'none'
    }
  }

  await loadDomains()
  document.getElementById('createModal').classList.add('show')
  document.getElementById('username').focus()
}

function closeCreateModal() {
  document.getElementById('createModal').classList.remove('show')
  document.getElementById('username').value = ''
}

async function createEmailFromModal() {
  const mailSource = localStorage.getItem('mailSource') || 'noopmail'
  const username = document.getElementById('username').value.trim()
  let domain = document.getElementById('domain').value
  // Chặn value rác từ dropdown ("null" / rỗng) — backend sẽ tự lấy domain qua /api/rd
  if (!domain || domain === 'null' || domain === 'undefined' || !domain.includes('.')) {
    domain = null
  }

  // TempMail ID và eTempMail không bắt buộc username (có thể null để random)
  if (mailSource !== 'tempmail-id' && mailSource !== 'etempmail') {
    if (!username) {
      showToast('Vui lòng nhập tên người dùng!', 'error')
      return
    }
    if (username.length < 3) {
      showToast('Tên phải có ít nhất 3 ký tự!', 'error')
      return
    }
    if (username.length > 15) {
      showToast('Tên không được vượt quá 15 ký tự!', 'error')
      return
    }
  }

  closeCreateModal()
  showLoading('Đang tạo email...')

  try {
    // TempMail ID và eTempMail: có thể truyền null cho username để random
    const finalUsername = (mailSource === 'tempmail-id' || mailSource === 'etempmail') ? (username || null) : username
    const result = await queueApiCall('/api/email/create', 'POST', {
      username: finalUsername,
      domain: domain,
    })

    if (result.success) {
      currentEmail = result.email
      localStorage.setItem('tempMailLastEmail', result.email)
      localStorage.setItem('tempMailLastEmailTime', Date.now().toString())
      if (result.secretKey) {
        localStorage.setItem('temporarymailSecretKey', result.secretKey)
      }
      if (result.token) {
        const source = localStorage.getItem('mailSource') || 'noopmail'
        if (source === 'mailio') {
          localStorage.setItem('mailioToken', result.token)
        } else if (source === 'apple') {
          localStorage.setItem('appleToken', result.token)
        }
      }
      if (result.cookies) {
        localStorage.setItem('edumailCookies', result.cookies)
      }
      if (result.password) {
        localStorage.setItem('tempmailapiPassword', result.password)
      }
      updateEmailDisplay(result.email)
      document.getElementById('username').value = ''
      displayedMessageIds.clear()

      // QUAN TRỌNG: Sync email trước khi fetch messages (cho tmail)
      debugLog('[CreateEmail] Email created:', result.email)
      debugLog('[CreateEmail] Source:', mailSource)

      const source = localStorage.getItem('mailSource') || 'noopmail'
      if (source === 'tmail') {
        debugLog('[CreateEmail] Syncing email for tmail...')
        try {
          await queueApiCall('/api/email/sync', 'POST', {
            email: result.email,
            secretKey: result.secretKey || null,
            token: result.token || null,
            tempmailapiPassword: result.password || null,
          })
          debugLog('[CreateEmail] Sync completed')
        } catch (syncError) {
          debugLog('[CreateEmail] Sync error:', syncError)
        }
      }

      // Sau khi sync xong, mới show skeleton và fetch messages
      showSkeletonMessages(3)
      await refreshMessages()
      hideLoading()
      showToast('✓ Email mới đã được tạo!', 'success')
      loadSiteStats() // Cập nhật stats ngay

      if (
        source === 'tempmail-id' ||
        source === 'noopmail' ||
        source === 'temporarymail' ||
        source === 'mailio'
      ) {
        await startPollingIfIMail()
      } else {
        startAutoRefresh()
      }
    } else {
      hideLoading()
      showToast(result.error, 'error')
    }
  } catch (error) {
    hideLoading()
    showToast('Lỗi: ' + error.message, 'error')
  }
}

async function createRandomEmail() {
  try {
    const result = await queueApiCall('/api/email/random', 'POST')
    if (result.success) {
      currentEmail = result.email
      localStorage.setItem('tempMailLastEmail', result.email)
      localStorage.setItem('tempMailLastEmailTime', Date.now().toString())
      if (result.secretKey) {
        localStorage.setItem('temporarymailSecretKey', result.secretKey)
      }
      if (result.token) {
        const source = localStorage.getItem('mailSource') || 'noopmail'
        if (source === 'mailio') {
          localStorage.setItem('mailioToken', result.token)
        } else if (source === 'apple') {
          localStorage.setItem('appleToken', result.token)
        }
      }
      if (result.cookies) {
        localStorage.setItem('edumailCookies', result.cookies)
      }
      if (result.password) {
        localStorage.setItem('tempmailapiPassword', result.password)
      }
      updateEmailDisplay(result.email)
      displayedMessageIds.clear()

      // QUAN TRỌNG: Sync email trước khi fetch messages (cho tmail)
      debugLog('[CreateRandomEmail] Email created:', result.email)
      const source = localStorage.getItem('mailSource') || 'noopmail'
      debugLog('[CreateRandomEmail] Source:', source)

      if (source === 'tmail') {
        debugLog('[CreateRandomEmail] Syncing email for tmail...')
        try {
          await queueApiCall('/api/email/sync', 'POST', {
            email: result.email,
            secretKey: result.secretKey || null,
            token: result.token || null,
            tempmailapiPassword: result.password || null,
          })
          debugLog('[CreateRandomEmail] Sync completed')
        } catch (syncError) {
          debugLog('[CreateRandomEmail] Sync error:', syncError)
        }
      }

      // Sau khi sync xong, mới show skeleton và fetch messages
      showSkeletonMessages(3)
      await refreshMessages()
      showToast('✓ Email của bạn đã sẵn sàng!', 'success')
      loadSiteStats() // Cập nhật stats ngay

      if (
        source === 'tempmail-id' ||
        source === 'noopmail' ||
        source === 'temporarymail' ||
        source === 'mailio'
      ) {
        await startPollingIfIMail()
      } else {
        startAutoRefresh()
      }
    } else {
      showToast(result.error, 'error')
    }
  } catch (error) {
    showToast('Lỗi: ' + error.message, 'error')
  }
}

async function createRandomEmailManual() {
  showLoading('Đang tạo email ngẫu nhiên...')
  try {
    const result = await queueApiCall('/api/email/random', 'POST')
    if (result.success) {
      currentEmail = result.email
      localStorage.setItem('tempMailLastEmail', result.email)
      localStorage.setItem('tempMailLastEmailTime', Date.now().toString())
      if (result.secretKey) {
        localStorage.setItem('temporarymailSecretKey', result.secretKey)
      }
      if (result.token) {
        const source = localStorage.getItem('mailSource') || 'noopmail'
        if (source === 'mailio') {
          localStorage.setItem('mailioToken', result.token)
        } else if (source === 'apple') {
          localStorage.setItem('appleToken', result.token)
        }
      }
      if (result.cookies) {
        localStorage.setItem('edumailCookies', result.cookies)
      }
      if (result.password) {
        localStorage.setItem('tempmailapiPassword', result.password)
      }
      updateEmailDisplay(result.email)
      displayedMessageIds.clear()

      // QUAN TRỌNG: Sync email trước khi fetch messages (cho tmail)
      debugLog('[CreateRandomEmailManual] Email created:', result.email)
      const source = localStorage.getItem('mailSource') || 'noopmail'
      debugLog('[CreateRandomEmailManual] Source:', source)

      if (source === 'tmail') {
        debugLog('[CreateRandomEmailManual] Syncing email for tmail...')
        try {
          await queueApiCall('/api/email/sync', 'POST', {
            email: result.email,
            secretKey: result.secretKey || null,
            token: result.token || null,
            tempmailapiPassword: result.password || null,
          })
          debugLog('[CreateRandomEmailManual] Sync completed')
        } catch (syncError) {
          debugLog('[CreateRandomEmailManual] Sync error:', syncError)
        }
      }

      // Sau khi sync xong, mới show skeleton và fetch messages
      showSkeletonMessages(3)
      await refreshMessages()
      hideLoading()
      showToast('✓ Email mới đã được tạo!', 'success')

      if (
        source === 'tempmail-id' ||
        source === 'noopmail' ||
        source === 'temporarymail' ||
        source === 'mailio'
      ) {
        await startPollingIfIMail()
      } else {
        startAutoRefresh()
      }
    } else {
      hideLoading()
      showToast(result.error, 'error')
    }
  } catch (error) {
    hideLoading()
    showToast('Lỗi: ' + error.message, 'error')
  }
}

async function refreshMessages(silent = false) {
  if (!currentEmail) {
    document.getElementById('messageCount').textContent = '0 thư'
    return
  }

  // DEBOUNCE: Nếu đang refresh, bỏ qua
  if (isRefreshingMessages) {
    debugLog('[RefreshMessages] Already refreshing, skipping...')
    return
  }

  // DEBOUNCE: Clear timeout cũ
  if (refreshMessagesTimeout) {
    clearTimeout(refreshMessagesTimeout)
  }

  // DEBOUNCE: Đợi 300ms trước khi thực sự gọi API (chỉ khi silent)
  return new Promise((resolve) => {
    refreshMessagesTimeout = setTimeout(async () => {
      isRefreshingMessages = true

      if (!silent && viewingMessageIndex === null) {
        showSkeletonMessages(3)
      }

      try {
        // Dùng queue thay vì gọi trực tiếp
        const result = await queueApiCall('/api/messages')
        if (result.success) {
          moaktSessionExpiredHandled = false

          const count = result.count || 0
          const oldCount = currentMessageCount
          currentMessages = result.messages || []

          if (viewingMessageIndex === null) {
            const isFirstLoad = oldCount === 0 || !silent
            displayMessages(currentMessages, isFirstLoad)
            document.getElementById('messageCount').textContent = count + ' thư'

            if (silent && count > oldCount && oldCount > 0) {
              showToast(
                '📬 Bạn có ' + (count - oldCount) + ' thư mới!',
                'info'
              )
              loadSiteStats()
            }
          } else {
            currentMessageCount = count
            document.getElementById('messageCount').textContent = count + ' thư'
            if (count > oldCount) {
              showToast(
                '📬 Có ' + (count - oldCount) + ' thư mới!',
                'info'
              )
              loadSiteStats()
            }
          }
        } else {
          if (result.sessionExpired && !moaktSessionExpiredHandled) {
            moaktSessionExpiredHandled = true
            currentEmail = null
            currentMessages = []
            currentMessageCount = 0
            viewingMessageIndex = null
            displayedMessageIds.clear()
            localStorage.removeItem('tempMailLastEmail')
            localStorage.removeItem('tempMailLastEmailTime')
            updateEmailDisplay(null)
            displayMessages([], true)
            document.getElementById('messageCount').textContent = '0 thư'
            document.getElementById('messagesListView')?.classList.remove('hide')
            document.getElementById('messageDetailView')?.classList.remove('show')
            if (autoRefreshInterval) {
              clearInterval(autoRefreshInterval)
              autoRefreshInterval = null
            }
            showToast('Phiên Moakt đã hết hạn. Vui lòng tạo email mới.', 'error')
          } else if (!silent) {
            showToast(result.error, 'error')
          }
        }
      } catch (error) {
        if (!silent) {
          showToast('Lỗi tải thư', 'error')
        }
      } finally {
        const messagesList = document.getElementById('messagesList')
        if (messagesList) {
          const skeletons = messagesList.querySelectorAll('.skeleton-message')
          skeletons.forEach((skeleton) => skeleton.remove())
        }
        isRefreshingMessages = false
        resolve()
      }
    }, silent ? 300 : 0) // Silent: đợi 300ms, không silent: gọi ngay
  })
}

function displayMessages(messages, clearAll = false) {
  const messagesList = document.getElementById('messagesList')
  const skeletons = messagesList.querySelectorAll('.skeleton-message')
  skeletons.forEach((skeleton) => skeleton.remove())

  if (!messages || messages.length === 0) {
    messagesList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>Chưa có thư nào</p>
            </div>
        `
    currentMessageCount = 0
    displayedMessageIds.clear()
    return
  }

  if (clearAll || displayedMessageIds.size === 0) {
    messagesList.innerHTML = ''
    displayedMessageIds.clear()
    messages.forEach((message, index) => {
      appendMessage(message, index, messagesList)
      displayedMessageIds.add(message.id)
    })
  } else {
    const newMessages = messages.filter(
      (msg) => !displayedMessageIds.has(msg.id)
    )

    if (newMessages.length > 0) {
      const emptyState = messagesList.querySelector('.empty-state')
      if (emptyState) {
        emptyState.remove()
      }

      newMessages.reverse().forEach((newMsg, index) => {
        const msgIndex = messages.findIndex((msg) => msg.id === newMsg.id)
        const card = createMessageCard(newMsg, msgIndex)
        messagesList.insertAdjacentHTML('afterbegin', card)
        displayedMessageIds.add(newMsg.id)

        setTimeout(() => {
          const cardElement = messagesList.querySelector(
            '[data-id="' + newMsg.id + '"]'
          )
          if (cardElement) {
            cardElement.style.animation = 'fadeIn 0.5s ease-out'
          }
        }, index * 50)
      })
    }

    messages.forEach((message) => {
      if (displayedMessageIds.has(message.id)) {
        const cardElement = messagesList.querySelector(
          '[data-id="' + message.id + '"]'
        )
        if (cardElement) {
          const timeElement = cardElement.querySelector('.message-time')
          if (timeElement) {
            const timeStr = formatDateLocal(message.datediff || message.date) || 'N/A'
            timeElement.innerHTML = '<i class="fas fa-clock"></i> ' + timeStr
          }
        }
      }
    })
  }

  currentMessageCount = messages.length
}

/**
 * Format date string sang thời gian tương đối (VN = UTC+7)
 * Input: "Sun, 08 Mar 2026 06:29:06 +0000 (UTC)" hoặc bất kỳ date string
 * Output: "5 phút trước", "2 giờ trước", "3 ngày trước"
 */
function formatDateLocal(dateStr) {
  if (!dateStr) return null;
  try {
    // Loại bỏ phần "(UTC)" nếu có để Date() parse được
    const cleaned = dateStr.replace(/\s*\(UTC\)\s*$/, '').trim();
    const date = new Date(cleaned);
    if (isNaN(date.getTime())) return dateStr;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 0) return 'Vừa xong';
    if (diffSec < 60) return 'Vừa xong';
    if (diffMin < 60) return `${diffMin} phút trước`;
    if (diffHour < 24) return `${diffHour} giờ trước`;
    if (diffDay < 7) return `${diffDay} ngày trước`;
    if (diffDay < 30) return `${Math.floor(diffDay / 7)} tuần trước`;

    // Quá 30 ngày thì hiện ngày tháng
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hour}:${minute}`;
  } catch (e) {
    return dateStr;
  }
}

function escapeHtmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function createMessageCard(message, index) {
  const preview = message.content
    ? message.content
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
      .trim()
    : ''
  const previewText = preview.length > 120 ? preview.substring(0, 120) + '...' : preview
  const senderName = escapeHtmlText(message.sender_name || 'Không rõ')
  const senderEmail = escapeHtmlText(message.sender_email || '')
  const subject = escapeHtmlText(message.subject || 'Không có tiêu đề')
  const messageId = escapeHtmlText(message.id || '')
  const timeStr = escapeHtmlText(formatDateLocal(message.datediff || message.date) || 'N/A')
  const safePreviewText = escapeHtmlText(previewText)
  const attachments =
    message.attachments && message.attachments.length > 0
      ? `<div class="message-attachments"><i class="fas fa-paperclip"></i> ${message.attachments.length} file đính kèm</div>`
      : ''

  return `
        <div class="message-card" onclick="viewMessageDetail(${index})" data-index="${index}" data-id="${messageId}">
            <div class="message-header">
                <div class="message-info">
                    <div class="message-sender">
                        <i class="fas fa-user-circle"></i>
                        ${senderName}
                    </div>
                    ${senderEmail ? `<div class="message-email">${senderEmail}</div>` : ''}
                    <div class="message-subject">${subject}</div>
                </div>
                <div class="message-time">
                    <i class="fas fa-clock"></i> ${timeStr}
                </div>
            </div>
            ${safePreviewText ? `<div class="message-preview">${safePreviewText}</div>` : ''}
            ${attachments}
        </div>
    `
}

function appendMessage(message, index, container) {
  const card = createMessageCard(message, index)
  container.insertAdjacentHTML('beforeend', card)
}

async function viewMessageDetail(index) {
  if (!currentMessages[index]) {
    return
  }

  const message = currentMessages[index]
  viewingMessageIndex = index
  const safeSubject = escapeHtmlText(message.subject || 'Không có tiêu đề')
  const safeSenderName = escapeHtmlText(message.sender_name || 'Không rõ')
  const safeSenderEmail = escapeHtmlText(message.sender_email || '')
  const safeTime = escapeHtmlText(formatDateLocal(message.datediff || message.date) || 'N/A')

  const detailHeader = document.getElementById('detailHeader')
  detailHeader.innerHTML = `
        <div class="detail-subject">${safeSubject}</div>
        <div class="detail-meta">
            <div class="detail-meta-item">
                <i class="fas fa-user"></i>
                <strong>${safeSenderName}</strong>
            </div>
            ${message.sender_email ? `
            <div class="detail-meta-item">
                <i class="fas fa-envelope"></i>
                ${safeSenderEmail}
            </div>
            ` : ''}
            <div class="detail-meta-item">
                <i class="fas fa-clock"></i>
                ${safeTime}
            </div>
            ${message.attachments && message.attachments.length > 0 ? `
            <div class="detail-meta-item">
                <i class="fas fa-paperclip"></i>
                ${message.attachments.length} file đính kèm
            </div>
            ` : ''}
        </div>
    `

  setDetailStatus(
    '<p style="color: var(--gray); text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin"></i> Đang tải nội dung...</p>'
  )

  document.getElementById('messagesListView').classList.add('hide')
  document.getElementById('messageDetailView').classList.add('show')
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })

  const source = localStorage.getItem('mailSource') || 'noopmail'

  // MailIO và Apple: Luôn gọi API để lấy nội dung đầy đủ
  if (source === 'mailio' || source === 'apple') {
    if (message.content || message.html) {
      // Đã có content, hiển thị luôn
      let html = ''
      if (message.html) {
        html = message.html
      } else {
        if (message.content && message.content.trim().startsWith('<')) {
          html = message.content
        } else {
          html = message.content || message.content_raw || ''
        }
      }
      setDetailEmailBody(html)
    } else {
      // Chưa có content, gọi API
      try {
        const result = await apiCall('/api/message/' + message.id, 'GET')
        if (result.success && result.message) {
          let content =
            result.message.content || result.message.content_raw || ''
          if (result.message.html) {
            content = result.message.html
          } else {
            if (
              result.message.content &&
              result.message.content.trim().startsWith('<')
            ) {
              content = result.message.content
            }
          }
          setDetailEmailBody(content)

          currentMessages[index].content =
            result.message.content || result.message.content_raw || ''
          currentMessages[index].content_raw =
            result.message.content_raw || result.message.content || ''
          if (result.message.html) {
            currentMessages[index].html = result.message.html
          }
        } else {
          setDetailStatus(EMPTY_MESSAGE_HTML)
        }
      } catch (error) {
        setDetailStatus(
          '<p style="color: var(--gray); text-align: center; padding: 40px;">Lỗi: ' +
            escapeHtmlText(error.message) +
            '</p>'
        )
      }
    }
  } else {
    if (
      (source === 'tempmail-id' ||
        source === 'noopmail' ||
        source === 'temporarymail' ||
        source === 'generatoremail' ||
        source === 'moakt' ||
        source === 'tempmailapi' ||
        source === 'inboxes') &&
      message.id
    ) {
      const isNoopMail = source === 'noopmail' || !message.html

      if (
        !isNoopMail &&
        (message.html ||
          (message.content && message.content.trim().startsWith('<')))
      ) {
        let html = ''
        if (message.html) {
          html = message.html
        } else {
          if (message.content && message.content.trim().startsWith('<')) {
            html = message.content
          } else {
            html = message.content || message.content_raw || ''
          }
        }
        setDetailEmailBody(html)
      } else {
        try {
          const result = await apiCall('/api/message/' + message.id, 'GET')
          if (result.success && result.message) {
            let content =
              result.message.content || result.message.content_raw || ''
            if (result.message.html) {
              content = result.message.html
            } else {
              if (
                result.message.content &&
                result.message.content.trim().startsWith('<')
              ) {
                content = result.message.content
              }
            }
            setDetailEmailBody(content)

            currentMessages[index].content =
              result.message.content || result.message.content_raw || ''
            currentMessages[index].content_raw =
              result.message.content_raw || result.message.content || ''
            if (result.message.html) {
              currentMessages[index].html = result.message.html
            }
          } else {
            setDetailEmailBody(message.content || message.content_raw)
            if (result.error) {
              // Không thể lấy nội dung đầy đủ
            }
          }
        } catch (error) {
          setDetailEmailBody(message.content || message.content_raw)
        }
      }
    } else {
      setDetailEmailBody(message.content || message.content_raw)
    }
  }
}

function closeMessageDetail() {
  viewingMessageIndex = null
  document.getElementById('messageDetailView').classList.remove('show')
  document.getElementById('messagesListView').classList.remove('hide')
  refreshMessages(true)
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

function openDeleteModal() {
  if (!currentEmail) {
    showToast('Chưa có email nào để xóa!', 'error')
    return
  }
  document.getElementById('deleteEmailAddress').textContent = currentEmail
  document.getElementById('deleteModal').classList.add('show')
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('show')
}

async function confirmDeleteEmail() {
  closeDeleteModal()
  if (!currentEmail) {
    showToast('Chưa có email nào để xóa!', 'error')
    return
  }

  showLoading('Đang xóa email...')
  try {
    const result = await apiCall('/api/email', 'DELETE')
    if (result.success) {
      if (result.newEmail) {
        currentEmail = result.newEmail
        localStorage.setItem('tempMailLastEmail', result.newEmail)
        localStorage.setItem('tempMailLastEmailTime', Date.now().toString())
        if (result.secretKey) {
          localStorage.setItem('temporarymailSecretKey', result.secretKey)
        }
        if (result.token) {
          const source = localStorage.getItem('mailSource') || 'noopmail'
          if (source === 'mailio') {
            localStorage.setItem('mailioToken', result.token)
          } else if (source === 'apple') {
            localStorage.setItem('appleToken', result.token)
          }
        }
        updateEmailDisplay(result.newEmail)
        displayedMessageIds.clear()
        showSkeletonMessages(3)
        await refreshMessages(false)
        hideLoading()
        showToast(
          '✓ Email đã được xóa! Đã chuyển sang: ' + result.newEmail,
          'success'
        )

        const source = localStorage.getItem('mailSource') || 'noopmail'
        if (
          source === 'tempmail-id' ||
          source === 'noopmail' ||
          source === 'temporarymail' ||
          source === 'mailio' ||
          source === 'apple'
        ) {
          await startPollingIfIMail()
        } else {
          startAutoRefresh()
        }
      } else {
        currentEmail = null
        localStorage.removeItem('tempMailLastEmail')
        localStorage.removeItem('tempMailLastEmailTime')
        localStorage.removeItem('temporarymailSecretKey')
        localStorage.removeItem('mailioToken')
        localStorage.removeItem('edumailCookies')
        localStorage.removeItem('appleToken')
        updateEmailDisplay(null)
        displayedMessageIds.clear()
        displayMessages([], true)

        showLoading('Đang tạo email mới...')
        try {
          const emailResult = await apiCall('/api/email/random', 'POST')
          if (emailResult.success) {
            currentEmail = emailResult.email
            localStorage.setItem('tempMailLastEmail', emailResult.email)
            localStorage.setItem('tempMailLastEmailTime', Date.now().toString())
            if (emailResult.secretKey) {
              localStorage.setItem(
                'temporarymailSecretKey',
                emailResult.secretKey
              )
            }
            if (emailResult.token) {
              const source = localStorage.getItem('mailSource') || 'noopmail'
              if (source === 'mailio') {
                localStorage.setItem('mailioToken', emailResult.token)
              } else if (source === 'apple') {
                localStorage.setItem('appleToken', emailResult.token)
              }
            }
            if (emailResult.password) {
              localStorage.setItem('tempmailapiPassword', emailResult.password)
            }
            updateEmailDisplay(emailResult.email)
            displayedMessageIds.clear()
            showSkeletonMessages(3)
            await refreshMessages(false)
            hideLoading()
            showToast(
              '✓ Email đã được xóa! Đã tạo email mới: ' + emailResult.email,
              'success'
            )

            const source = localStorage.getItem('mailSource') || 'noopmail'
            if (
              source === 'tempmail-id' ||
              source === 'noopmail' ||
              source === 'temporarymail' ||
              source === 'mailio'
            ) {
              await startPollingIfIMail()
            } else {
              startAutoRefresh()
            }
          } else {
            hideLoading()
            showToast(
              '✓ Email đã được xóa! ' +
              (emailResult.error || 'Không thể tạo email mới'),
              'warning'
            )
          }
        } catch (error) {
          hideLoading()
          showToast(
            '✓ Email đã được xóa! Lỗi tạo email mới: ' + error.message,
            'warning'
          )
        }
      }
    } else {
      hideLoading()
      showToast(result.error, 'error')
    }
  } catch (error) {
    hideLoading()
    showToast('Lỗi: ' + error.message, 'error')
  }
}

function copyEmail() {
  if (!currentEmail) {
    showToast('Chưa có email để copy!', 'error')
    return
  }
  navigator.clipboard.writeText(currentEmail)
  showToast('✓ Đã copy email!', 'success')
}

function startPollingIfIMail() {
  const source = localStorage.getItem('mailSource') || 'noopmail'
  if (
    source !== 'tempmail-id' &&
    source !== 'noopmail' &&
    source !== 'temporarymail' &&
    source !== 'mailio'
  ) {
    return
  }

  if (iMailPollingInterval) {
    clearInterval(iMailPollingInterval)
  }

  let sourceName = 'TempMail ID'
  let interval = 8

  if (source === 'noopmail') {
    sourceName = 'NoopMail'
    interval = 8
  } else if (source === 'temporarymail') {
    sourceName = 'TemporaryMail'
    interval = 8
  } else if (source === 'mailio') {
    sourceName = 'MailIO'
    interval = 8
  }

  refreshMessages(true)
  iMailPollingInterval = setInterval(() => {
    if (currentEmail) {
      refreshMessages(true)
    }
  }, interval * 1000)
}

function stopPollingIfIMail() {
  if (iMailPollingInterval) {
    clearInterval(iMailPollingInterval)
    iMailPollingInterval = null
  }
}

function startAutoRefresh() {
  const source = localStorage.getItem('mailSource') || 'noopmail'
  if (
    source === 'tempmail-id' ||
    source === 'noopmail' ||
    source === 'temporarymail' ||
    source === 'mailio'
  ) {
    startPollingIfIMail()
    return
  }

  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval)
  }

  // ❌ XÓA: Không gọi refreshMessages() ngay nữa để tránh duplicate calls
  // if (currentEmail) {
  //   refreshMessages(true)
  // }

  // Chỉ set interval, không gọi ngay
  autoRefreshInterval = setInterval(() => {
    if (currentEmail) {
      refreshMessages(true)
    }
  }, 10000) // Tăng lên 10 giây (từ 8 giây) để giảm tải
}

async function loadIPInfo() {
  try {
    const response = await fetch('/api/ipinfo')
    const data = await response.json()

    if (data.ip) {
      const ipInfoContent = document.getElementById('ipInfoContent')
      let html = ''

      html += `
                    <div class="ip-info-item">
                        <i class="fas fa-network-wired"></i>
                        <strong>IP:</strong>
                        <span>${data.ip}</span>
                    </div>`

      if (data.city) {
        html += `
                    <div class="ip-info-item">
                        <i class="fas fa-city"></i>
                        <strong>City:</strong>
                        <span>${data.city}</span>
                    </div>`
      }

      if (data.region) {
        html += `
                    <div class="ip-info-item">
                        <i class="fas fa-map-marker-alt"></i>
                        <strong>Region:</strong>
                        <span>${data.region}</span>
                    </div>`
      }

      if (data.country) {
        html += `
                    <div class="ip-info-item">
                        <i class="fas fa-flag"></i>
                        <strong>Country:</strong>
                        <span>${data.country}</span>
                    </div>`
      }

      if (data.connection && data.connection.isp) {
        html += `
                    <div class="ip-info-item">
                        <i class="fas fa-wifi"></i>
                        <strong>ISP:</strong>
                        <span>${data.connection.isp}</span>
                    </div>`
      }

      if (data.postal) {
        html += `
                    <div class="ip-info-item">
                        <i class="fas fa-mail-bulk"></i>
                        <strong>Postal code:</strong>
                        <span>${data.postal}</span>
                    </div>`
      }

      if (data.continent) {
        html += `
                    <div class="ip-info-item">
                        <i class="fas fa-globe-americas"></i>
                        <strong>Continent:</strong>
                        <span>${data.continent}</span>
                    </div>`
      }

      if (html) {
        ipInfoContent.innerHTML = html
      } else {
        ipInfoContent.innerHTML =
          '<div class="ip-info-loading"><span>Không thể tải thông tin IP</span></div>'
      }
    } else {
      document.getElementById('ipInfoContent').innerHTML =
        '<div class="ip-info-loading"><span>Không thể tải thông tin IP</span></div>'
    }
  } catch (error) {
    document.getElementById('ipInfoContent').innerHTML =
      '<div class="ip-info-loading"><span>Lỗi khi tải thông tin IP</span></div>'
  }
}

function updateClockCompactInline() {
  const now = new Date()
  const utc = now.getTime() + now.getTimezoneOffset() * 60000
  const vietnamTime = new Date(utc + 25200000) // UTC+7

  let hours = vietnamTime.getHours()
  let minutes = vietnamTime.getMinutes()
  let seconds = vietnamTime.getSeconds()

  hours = hours < 10 ? '0' + hours : hours
  minutes = minutes < 10 ? '0' + minutes : minutes
  seconds = seconds < 10 ? '0' + seconds : seconds

  const hoursEl = document.getElementById('timeHours')
  const minutesEl = document.getElementById('timeMinutes')
  const secondsEl = document.getElementById('timeSeconds')
  const dateEl = document.getElementById('timeDate')

  if (hoursEl) {
    hoursEl.textContent = hours
  }
  if (minutesEl) {
    minutesEl.textContent = minutes
  }
  if (secondsEl) {
    secondsEl.textContent = seconds
  }

  const day = vietnamTime.getDate()
  const month = vietnamTime.getMonth() + 1
  const year = vietnamTime.getFullYear()

  if (dateEl) {
    dateEl.textContent =
      (day < 10 ? '0' + day : day) +
      '/' +
      (month < 10 ? '0' + month : month) +
      '/' +
      year
  }
}

function startClock() {
  updateClockCompactInline()
  setInterval(updateClockCompactInline, 1000)
}

window.addEventListener('DOMContentLoaded', async () => {
  init()
  loadIPInfo()
  startClock()
})

document.addEventListener('keypress', (event) => {
  const createModal = document.getElementById('createModal')
  if (
    createModal &&
    createModal.classList.contains('show') &&
    event.key === 'Enter'
  ) {
    createEmailFromModal()
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeCreateModal()
    closeDeleteModal()
  }
})

// Event listeners cho modal - phải đợi DOM ready
document.addEventListener('DOMContentLoaded', function () {
  const createModal = document.getElementById('createModal')
  if (createModal) {
    createModal.addEventListener('click', (event) => {
      if (event.target.id === 'createModal') {
        closeCreateModal()
      }
    })
  }

  const deleteModal = document.getElementById('deleteModal')
  if (deleteModal) {
    deleteModal.addEventListener('click', (event) => {
      if (event.target.id === 'deleteModal') {
        closeDeleteModal()
      }
    })
  }
});

// ============================================
// Code moved from index.html
// ============================================

// Override createEmailFromModal để bỏ qua validation username cho etempmail
// Phải làm ngay (không đợi DOMContentLoaded) để override trước khi app.js load
(function () {
  // Đợi app.js load xong
  let checkAttempts = 0;
  const maxAttempts = 50;
  const maxOverrideAttempts = 50;
  const checkInterval = setInterval(function () {
    // Kiểm tra xem createEmailFromModal đã được định nghĩa chưa
    if (typeof window.createEmailFromModal === 'function' && !window.createEmailFromModal._overridden) {
      const originalCreateEmailFromModal = window.createEmailFromModal;
      window.createEmailFromModal = function () {
        // Lấy mail source hiện tại
        const mailSource = document.getElementById('mailSource');
        const selectedSource = mailSource ? mailSource.value : 'noopmail';

        // Nếu là etempmail hoặc tempmail-id, đảm bảo username là empty và không validate
        if (selectedSource === 'etempmail' || selectedSource === 'tempmail-id') {
          const usernameInput = document.getElementById('username');
          if (usernameInput) {
            usernameInput.value = ''; // Xóa username
            usernameInput.removeAttribute('required'); // Xóa required nếu có
          }

          // Bỏ qua validation - gọi trực tiếp API
          const domainSelect = document.getElementById('domain');
          const domain = domainSelect ? domainSelect.value : null;

          if (!domain) {
            // Hiển thị lỗi nếu chưa chọn domain
            if (typeof window.showToast === 'function') {
              window.showToast('Vui lòng chọn domain!', 'error');
            } else if (typeof window.showError === 'function') {
              window.showError('Vui lòng chọn domain!');
            } else {
              alert('Vui lòng chọn domain!');
            }
            return;
          }

          // Gọi API trực tiếp với username = null
          if (typeof window.apiCall === 'function') {
            const apiPromise = window.apiCall('/api/email/create', 'POST', { username: null, domain: domain });

            // Xử lý promise nếu có
            if (apiPromise && typeof apiPromise.then === 'function') {
              apiPromise.then(function (result) {
                // Đóng modal và cập nhật UI nếu thành công
                if (result && result.success) {
                  // Cập nhật email hiển thị
                  const currentEmailEl = document.getElementById('currentEmail');
                  if (currentEmailEl && result.email) {
                    currentEmailEl.innerHTML = result.email;
                    currentEmailEl.classList.remove('email-empty');

                    // Hiển thị copy button
                    const copyBtn = document.getElementById('copyBtn');
                    if (copyBtn) {
                      copyBtn.style.display = 'block';
                    }
                  }

                  // Refresh messages nếu có function
                  if (typeof window.refreshMessages === 'function') {
                    setTimeout(function () {
                      window.refreshMessages();
                    }, 500);
                  }

                  // Đóng modal
                  const createModal = document.getElementById('createModal');
                  if (createModal && typeof window.closeCreateModal === 'function') {
                    window.closeCreateModal();
                  }

                  // Hiển thị thông báo thành công
                  if (typeof window.showToast === 'function') {
                    window.showToast('Email đã được tạo thành công!', 'success');
                  }
                }
              }).catch(function (error) {
                // API call error
              });
            }

            return apiPromise;
          } else if (typeof window.createEmail === 'function') {
            const createPromise = window.createEmail(null, domain);

            if (createPromise && typeof createPromise.then === 'function') {
              createPromise.then(function (result) {
                if (result && result.success) {
                  // Cập nhật email hiển thị
                  const currentEmailEl = document.getElementById('currentEmail');
                  if (currentEmailEl && result.email) {
                    currentEmailEl.innerHTML = result.email;
                    currentEmailEl.classList.remove('email-empty');

                    // Hiển thị copy button
                    const copyBtn = document.getElementById('copyBtn');
                    if (copyBtn) {
                      copyBtn.style.display = 'block';
                    }
                  }

                  // Refresh messages nếu có function
                  if (typeof window.refreshMessages === 'function') {
                    setTimeout(function () {
                      window.refreshMessages();
                    }, 500);
                  }

                  // Đóng modal
                  const createModal = document.getElementById('createModal');
                  if (createModal && typeof window.closeCreateModal === 'function') {
                    window.closeCreateModal();
                  }

                  // Hiển thị thông báo thành công
                  if (typeof window.showToast === 'function') {
                    window.showToast('Email đã được tạo thành công!', 'success');
                  }
                }
              }).catch(function (error) {
                // createEmail error
              });
            }

            return createPromise;
          } else {
            // No apiCall or createEmail function found
          }
        }

        // Gọi function gốc cho các source khác
        return originalCreateEmailFromModal.apply(this, arguments);
      };
      window.createEmailFromModal._overridden = true;
      clearInterval(checkInterval);
    }
    checkAttempts++;
    if (checkAttempts >= maxOverrideAttempts) {
      clearInterval(checkInterval);
    }
  }, 100);
})();

// Xử lý ẩn/hiện username field khi chọn nguồn mail
function updateUsernameFieldVisibility() {
  const mailSource = document.getElementById('mailSource');
  const usernameGroup = document.getElementById('usernameGroup');
  const usernameInput = document.getElementById('username');
  const domainHelp = document.getElementById('domainHelp');
  const etempmailHelp = document.getElementById('etempmailHelp');

  if (!mailSource || !usernameGroup) return;

  const selectedSource = mailSource.value;

  // Ẩn username field cho tempmail-id và etempmail (username luôn random)
  if (selectedSource === 'tempmail-id' || selectedSource === 'etempmail') {
    // Sử dụng cả style.display và class để đảm bảo ẩn
    usernameGroup.style.display = 'none';
    usernameGroup.classList.add('hidden');
    // Disable input để chắc chắn không nhập được
    if (usernameInput) {
      usernameInput.disabled = true;
      usernameInput.value = ''; // Xóa giá trị nếu có
    }

    if (selectedSource === 'tempmail-id') {
      if (domainHelp) domainHelp.style.display = 'block';
      if (etempmailHelp) etempmailHelp.style.display = 'none';
    } else if (selectedSource === 'etempmail') {
      if (domainHelp) domainHelp.style.display = 'none';
      if (etempmailHelp) etempmailHelp.style.display = 'block';
    }
  } else {
    // Hiện username field cho các nguồn khác
    usernameGroup.style.display = 'flex';
    usernameGroup.classList.remove('hidden');
    if (usernameInput) {
      usernameInput.disabled = false;
    }
    if (domainHelp) domainHelp.style.display = 'none';
    if (etempmailHelp) etempmailHelp.style.display = 'none';
  }
}

// Gọi khi trang load và khi đổi nguồn mail
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', function () {
    updateUsernameFieldVisibility();

    const mailSource = document.getElementById('mailSource');
    if (mailSource && typeof mailSource.addEventListener === 'function') {
      mailSource.addEventListener('change', updateUsernameFieldVisibility);
    }

    // Gọi khi mở modal tạo email (để đảm bảo username field được ẩn/hiện đúng)
    const createModal = document.getElementById('createModal');
    if (createModal) {
      // Sử dụng MutationObserver để detect khi modal được hiển thị
      const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const style = createModal.getAttribute('style');
            if (style && (style.includes('display: block') || style.includes('display:flex'))) {
              // Delay một chút để đảm bảo modal đã render xong
              setTimeout(updateUsernameFieldVisibility, 50);
            }
          }
          // Cũng check class 'show'
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            if (createModal.classList.contains('show')) {
              setTimeout(updateUsernameFieldVisibility, 50);
            }
          }
        });
      });
      observer.observe(createModal, {
        attributes: true,
        attributeFilter: ['style', 'class'],
        childList: false,
        subtree: false
      });

      // Hoặc dùng event listener cho modal show (nếu dùng Bootstrap)
      if (createModal && typeof createModal.addEventListener === 'function') {
        createModal.addEventListener('shown.bs.modal', function () {
          updateUsernameFieldVisibility();
        });
      }
    }

    // Override function openCreateModal nếu có (để gọi updateUsernameFieldVisibility trước khi mở modal)
    if (typeof window.openCreateModal === 'function') {
      const originalOpenCreateModal = window.openCreateModal;
      window.openCreateModal = function () {
        updateUsernameFieldVisibility();
        // Gọi lại sau khi modal mở
        setTimeout(updateUsernameFieldVisibility, 100);
        return originalOpenCreateModal.apply(this, arguments);
      };
    }
  });
}

// Override function openCreateModal ngay khi script load (trước khi DOMContentLoaded)
// Để đảm bảo function có sẵn khi app.js gọi
// Sử dụng setInterval để check và override khi app.js đã load
let overrideAttempts = 0;
const maxOverrideAttempts = 50; // Thử trong 5 giây (50 * 100ms)
const overrideInterval = setInterval(function () {
  if (typeof window.openCreateModal === 'function' && !window.openCreateModal._overridden) {
    const originalOpenCreateModal = window.openCreateModal;
    window.openCreateModal = function () {
      updateUsernameFieldVisibility();
      // Gọi lại sau khi modal mở
      setTimeout(updateUsernameFieldVisibility, 100);
      return originalOpenCreateModal.apply(this, arguments);
    };
    window.openCreateModal._overridden = true;
    clearInterval(overrideInterval);
  }
  overrideAttempts++;
  if (overrideAttempts >= maxOverrideAttempts) {
    clearInterval(overrideInterval);
  }
}, 100);

// Thêm interval để liên tục check và ẩn username field nếu cần (fallback)
// Chỉ check khi modal đang mở
setInterval(function () {
  const mailSource = document.getElementById('mailSource');
  const usernameGroup = document.getElementById('usernameGroup');
  const createModal = document.getElementById('createModal');

  if (mailSource && usernameGroup && createModal) {
    // Chỉ check khi modal đang hiển thị
    const isModalVisible = createModal.classList.contains('show') ||
      createModal.style.display === 'flex' ||
      createModal.style.display === 'block';

    if (isModalVisible) {
      const selectedSource = mailSource.value;
      if (selectedSource === 'etempmail' || selectedSource === 'tempmail-id') {
        if (usernameGroup.style.display !== 'none' && !usernameGroup.classList.contains('hidden')) {
          updateUsernameFieldVisibility();
        }
        // Đảm bảo input bị disable và xóa giá trị
        const usernameInput = document.getElementById('username');
        if (usernameInput) {
          if (!usernameInput.disabled) {
            usernameInput.disabled = true;
          }
          if (usernameInput.value) {
            usernameInput.value = '';
          }
        }
      }
    }
  }
}, 300); // Check mỗi 300ms

// ============================================
// ADMIN: Load enabled sources dynamically
// ============================================
async function loadEnabledSources() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/sources/enabled`);
    const result = await response.json();

    if (result.success && result.sources) {
      const mailSourceSelect = document.getElementById('mailSource');
      if (!mailSourceSelect) return;

      // Source names mapping - CHỈ GIỮ CÁC NGUỒN CÓ THẬT
      const sourceNames = {
        'tmail': 'TMail',
        'noopmail': 'NoopMail',
        'temporarymail': 'TemporaryMail',
        'mailio': 'Mail.io',
        'pmail': 'PMAIL (IMAP)',
        'etempmail': 'eTempMail',
        'tinyhost': 'TinyHost',
        'edumail': 'EduMail',
        'apple': 'Apple.edu',
        'generatoremail': 'Generator.email',
        'moakt': 'Moakt.com',
        'tempmailapi': 'TempMailAPI',
        'inboxes': 'Inboxes'
      };

      // Xóa sạch dropdown cũ
      mailSourceSelect.innerHTML = '';

      // Chỉ thêm những nguồn nào ADMIN ĐÃ BẬT và CÓ TRONG MAPPING
      result.sources.forEach(sourceId => {
        if (sourceNames[sourceId]) {
          const option = document.createElement('option');
          option.value = sourceId;
          option.textContent = sourceNames[sourceId];
          mailSourceSelect.appendChild(option);
        }
      });

      // Set giá trị hiện tại
      // Ưu tiên: localStorage → defaultSource từ API → nguồn đầu tiên
      const storedSource = localStorage.getItem('mailSource');
      const currentSource = storedSource || result.defaultSource || result.sources[0];

      if (result.sources.includes(currentSource)) {
        mailSourceSelect.value = currentSource;
        // Lưu vào localStorage nếu chưa có
        if (!storedSource) {
          localStorage.setItem('mailSource', currentSource);
        }
      } else {
        // Nếu source đã lưu bị disabled, chuyển sang default
        mailSourceSelect.value = result.defaultSource || result.sources[0];
        localStorage.setItem('mailSource', mailSourceSelect.value);
      }
    }
  } catch (error) {
    debugLog('[LoadSources] Error:', error);
  }
}

// Call on DOMContentLoaded to ensure DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadEnabledSources);
} else {
  // DOM already loaded
  loadEnabledSources();
}

// ============================================
// VIDEO DOWNLOADER MODULE
// ============================================

function openVideoModal() {
  var modal = document.getElementById('videoModal');
  modal.classList.add('show');
  document.getElementById('videoUrl').value = '';
  document.getElementById('videoResults').style.display = 'none';
  document.getElementById('videoResults').innerHTML = '';
  document.getElementById('videoError').style.display = 'none';
  document.getElementById('videoUrl').focus();
}

function closeVideoModal() {
  document.getElementById('videoModal').classList.remove('show');
}

async function fetchVideoData() {
  var url = document.getElementById('videoUrl').value.trim();
  if (!url) {
    showToast('Vui lòng nhập URL video', 'error');
    return;
  }
  var fetchBtn = document.getElementById('fetchVideoBtn');
  var resultsDiv = document.getElementById('videoResults');
  var errorDiv = document.getElementById('videoError');
  errorDiv.style.display = 'none';
  resultsDiv.style.display = 'block';
  resultsDiv.innerHTML = '<div class="video-loading"><i class="fas fa-spinner fa-spin"></i><p>Đang tìm video... Vui lòng đợi</p></div>';
  // Custom loading: giữ nguyên kích thước button
  var originalBtnHTML = fetchBtn.innerHTML;
  fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tìm...';
  fetchBtn.disabled = true;
  try {
    var result = await apiCall('/api/video/download', 'POST', { url: url });
    if (!result.success) {
      throw new Error(result.error || 'Không thể tải video');
    }
    renderVideoResults(result.data, result.platform, url);
  } catch (error) {
    resultsDiv.style.display = 'none';
    errorDiv.style.display = 'block';
    errorDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i> ' + (error.message || 'Lỗi không xác định');
  } finally {
    fetchBtn.innerHTML = originalBtnHTML;
    fetchBtn.disabled = false;
  }
}

function renderVideoResults(data, platform, originalUrl) {
  var resultsDiv = document.getElementById('videoResults');
  var platformColors = {
    youtube: '#FF0000', tiktok: '#000000', facebook: '#1877F2',
    instagram: '#E4405F', twitter: '#1DA1F2', spotify: '#1DB954',
    reddit: '#FF4500', pinterest: '#E60023', soundcloud: '#FF5500',
    dailymotion: '#0066DC', unknown: '#6366f1'
  };
  var title = data.title || 'Video';
  var thumbnail = data.thumbnail || '';
  var duration = data.duration ? formatVideoDuration(data.duration) : '';
  var color = platformColors[platform] || platformColors.unknown;
  var html = '<div class="video-info-card"><div class="video-info-header">';
  if (thumbnail) {
    html += '<img src="' + thumbnail + '" alt="Thumbnail" class="video-thumbnail" onerror="this.style.display=\'none\'">';
  }
  html += '<div class="video-meta">';
  html += '<h4>' + escapeVideoHtml(title) + '</h4>';
  html += '<span class="video-platform-badge" style="background:' + color + '">' + platform.toUpperCase() + '</span>';
  if (duration) html += '<div class="video-duration"><i class="fas fa-clock"></i> ' + duration + '</div>';
  html += '</div></div>';
  // Video section
  if (data.videos && data.videos.length > 0) {
    html += '<div class="video-section-label"><i class="fas fa-film"></i> Video</div>';
    html += '<div class="video-download-links">';
    data.videos.forEach(function (v) {
      var label = v.quality || v.format || 'Video';
      var size = v.size || '';
      if (platform === 'youtube') {
        var escapedUrl = escapeVideoHtml(v.url).replace(/'/g, "\\'");
        html += '<a href="javascript:void(0)" class="video-download-link" onclick="handleYTSaveClick(this, \'' + escapedUrl + '\')">'
        html += '<div class="dl-info"><span>' + escapeVideoHtml(label) + '</span>';
        if (size) html += '<span class="dl-badge">' + escapeVideoHtml(size) + '</span>';
        html += '</div>';
        html += '<i class="fas fa-download"></i></a>';
      } else {
        html += createVideoDownloadLink(v.url, label, size, platform, v.format || 'mp4');
      }
    });
    html += '</div>';
  }
  // Audio section
  if (data.audios && data.audios.length > 0) {
    html += '<div class="video-section-label"><i class="fas fa-music"></i> Audio</div>';
    html += '<div class="video-download-links">';
    data.audios.forEach(function (a) {
      var label = a.quality || a.format || 'Audio';
      var size = a.size || '';
      if (platform === 'youtube') {
        var escapedUrl = escapeVideoHtml(a.url).replace(/'/g, "\\'");
        html += '<a href="javascript:void(0)" class="video-download-link" onclick="handleYTSaveClick(this, \'' + escapedUrl + '\')">'
        html += '<div class="dl-info"><span>' + escapeVideoHtml(label) + '</span>';
        if (size) html += '<span class="dl-badge">' + escapeVideoHtml(size) + '</span>';
        html += '</div>';
        html += '<i class="fas fa-download"></i></a>';
      } else {
        html += createVideoDownloadLink(a.url, label, size, platform, a.format || 'mp3');
      }
    });
    html += '</div>';
  }
  // Generic downloads (TikTok, Twitter, etc.)
  if (data.downloads && data.downloads.length > 0) {
    html += '<div class="video-section-label"><i class="fas fa-download"></i> Tải xuống</div>';
    html += '<div class="video-download-links">';
    data.downloads.forEach(function (d, i) {
      var label = d.text || d.quality || ('Download ' + (i + 1));
      html += createVideoDownloadLink(d.url, label, '', platform);
    });
    html += '</div>';
  }
  if (data.downloadUrl || data.download_url) {
    html += '<div class="video-download-links">';
    html += createVideoDownloadLink(data.downloadUrl || data.download_url, '⬇️ Tải xuống', '');
    html += '</div>';
  }
  if (data.data && Array.isArray(data.data)) {
    html += '<div class="video-download-links">';
    data.data.forEach(function (item, i) {
      if (item.url) {
        html += createVideoDownloadLink(item.url, '⬇️ Download ' + (i + 1), '');
      }
    });
    html += '</div>';
  }
  html += '</div>';
  resultsDiv.innerHTML = html;
}

function createVideoDownloadLink(url, label, badge, platform, format) {
  if (!url) return '';
  var badgeHtml = badge ? ('<span class="dl-badge">' + escapeVideoHtml(badge) + '</span>') : '';
  // Dùng proxy download cho TikTok, Twitter, v.v. để tải về thay vì mở tab mới
  var useProxy = platform && ['tiktok', 'twitter'].indexOf(platform) !== -1;
  var downloadUrl = url;
  if (useProxy) {
    var ext = format || 'mp4';
    var filename = (platform || 'video') + '_' + Date.now() + '.' + ext;
    downloadUrl = '/api/video/proxy-download?url=' + encodeURIComponent(url) + '&filename=' + encodeURIComponent(filename);
  }
  return '<a href="' + downloadUrl + '"' + (useProxy ? '' : ' target="_blank" rel="noopener noreferrer"') + ' class="video-download-link">' +
    '<div class="dl-info"><span>' + escapeVideoHtml(label) + '</span>' + badgeHtml + '</div>' +
    '<i class="fas fa-download"></i></a>';
}

function formatVideoDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

function escapeVideoHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function handleYTSaveClick(btn, mediaUrl) {
  var origHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang xử lý...';
  btn.style.pointerEvents = 'none';
  btn.onclick = null;

  async function pollDownload() {
    try {
      var data = await apiCall('/api/video/youtube/ytsave', 'POST', { url: mediaUrl });
      console.log('[YTSave] Response:', data);
      if (data.status === 'completed' && data.fileUrl) {
        btn.innerHTML = '<i class="fas fa-check"></i> Hoàn tất!';
        // Mở link download
        var a = document.createElement('a');
        a.href = data.fileUrl;
        a.target = '_blank';
        a.download = data.fileName || 'video.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () {
          btn.innerHTML = origHtml;
          btn.style.pointerEvents = '';
          btn.onclick = function () { handleYTSaveClick(btn, mediaUrl); };
        }, 2000);
      } else if (data.status === 'processing') {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (data.progress || 'Đang render...');
        setTimeout(pollDownload, 2000);
      } else {
        btn.innerHTML = origHtml;
        btn.style.pointerEvents = '';
        btn.onclick = function () { handleYTSaveClick(btn, mediaUrl); };
        alert('Lỗi tải video. Thử lại sau.');
      }
    } catch (err) {
      console.error('[YTSave] Error:', err);
      btn.innerHTML = origHtml;
      btn.style.pointerEvents = '';
      btn.onclick = function () { handleYTSaveClick(btn, mediaUrl); };
      alert('Lỗi: ' + err.message);
    }
  }
  pollDownload();
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && document.getElementById('videoModal').classList.contains('show')) {
    var activeEl = document.activeElement;
    if (activeEl && activeEl.id === 'videoUrl') {
      fetchVideoData();
    }
  }
});

// ===== SITE STATS FOOTER =====
async function loadSiteStats() {
  try {
    const res = await fetch('/api/site-stats')
    const data = await res.json()
    console.log('[Stats] API response:', data)
    if (data.success) {
      const emailEl = document.getElementById('statEmails')
      const receivedEl = document.getElementById('statReceived')
      const onlineEl = document.getElementById('statOnline')
      console.log('[Stats] Elements found:', !!emailEl, !!receivedEl, !!onlineEl)
      if (emailEl) emailEl.textContent = (data.emailsCreated || 0).toLocaleString()
      if (receivedEl) receivedEl.textContent = (data.messagesReceived || 0).toLocaleString()
      if (onlineEl) onlineEl.textContent = (data.onlineUsers || 0).toLocaleString()
      console.log('[Stats] Updated to:', data.emailsCreated, data.messagesReceived, data.onlineUsers)
    }
  } catch (e) {
    console.error('[Stats] Error:', e)
  }
}

// Load stats ngay và mỗi 5 giây
loadSiteStats()
setInterval(loadSiteStats, 5000)

// Heartbeat — ping /api/check mỗi 5 giây để track online users
async function heartbeat() {
  try {
    const res = await fetch('/api/check', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      const onlineEl = document.getElementById('statOnline')
      if (onlineEl) onlineEl.textContent = (data.online || 1).toLocaleString()
    }
  } catch (e) {
    // Silent fail
  }
}
heartbeat()
setInterval(heartbeat, 5000)
