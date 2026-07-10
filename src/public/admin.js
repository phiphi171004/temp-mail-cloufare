// Admin Panel JavaScript

const API_BASE_URL = (() => {
    const hostname = window.location.hostname;
    const port = window.location.port;

    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        return '';
    }

    if (port && port !== '3000') {
        return 'http://localhost:3000';
    }

    if (window.location.protocol === 'file:') {
        return 'http://localhost:3000';
    }

    return '';
})();

let isLoggedIn = false;
let currentConfig = null;

// Check if already logged in
if (sessionStorage.getItem('adminLoggedIn') === 'true') {
    isLoggedIn = true;
    showAdminPanel();
    loadConfig();
}

// Login
async function login() {
    const password = document.getElementById('password').value;

    if (!password) {
        showAlert('loginAlert', 'Vui lòng nhập mật khẩu!', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const result = await response.json();

        if (result.success) {
            isLoggedIn = true;
            sessionStorage.setItem('adminLoggedIn', 'true');
            showAdminPanel();
            loadConfig();
        } else {
            showAlert('loginAlert', result.error || 'Mật khẩu không đúng!', 'error');
        }
    } catch (error) {
        showAlert('loginAlert', 'Lỗi kết nối: ' + error.message, 'error');
    }
}

// Logout
function logout() {
    isLoggedIn = false;
    sessionStorage.removeItem('adminLoggedIn');
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('adminPanel').style.display = 'none';
    document.getElementById('password').value = '';
}

// Show admin panel
function showAdminPanel() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
}

// Load config
async function loadConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/config`);
        const result = await response.json();

        if (result.success) {
            currentConfig = result.config;
            renderConfig();
        } else {
            showAlert('adminAlert', 'Không thể tải cấu hình!', 'error');
        }
    } catch (error) {
        showAlert('adminAlert', 'Lỗi: ' + error.message, 'error');
    }
}

// Render config
function renderConfig() {
    if (!currentConfig) return;

    // Update stats
    const total = Object.keys(currentConfig.enabledSources).length;
    const enabled = Object.values(currentConfig.enabledSources).filter(v => v).length;
    const disabled = total - enabled;

    document.getElementById('totalSources').textContent = total;
    document.getElementById('enabledSources').textContent = enabled;
    document.getElementById('disabledSources').textContent = disabled;

    // Populate default source selector
    const defaultSelect = document.getElementById('defaultSourceSelect');
    defaultSelect.innerHTML = '<option value="">Chọn nguồn mặc định...</option>';

    Object.keys(currentConfig.enabledSources).forEach(sourceId => {
        if (currentConfig.enabledSources[sourceId]) {
            const option = document.createElement('option');
            option.value = sourceId;
            option.textContent = getSourceName(sourceId);
            if (sourceId === currentConfig.defaultSource) {
                option.selected = true;
            }
            defaultSelect.appendChild(option);
        }
    });

    // Render sources grid
    const sourcesGrid = document.getElementById('sourcesGrid');
    sourcesGrid.innerHTML = '';

    Object.keys(currentConfig.enabledSources).forEach(sourceId => {
        const isEnabled = currentConfig.enabledSources[sourceId];
        const isDefault = sourceId === currentConfig.defaultSource;

        const card = document.createElement('div');
        card.className = `source-card ${isEnabled ? 'enabled' : 'disabled'}`;
        card.innerHTML = `
      <div class="source-header">
        <div class="source-name">${getSourceName(sourceId)}</div>
        <div>
          ${isDefault ? '<span class="source-badge default">MẶC ĐỊNH</span>' : ''}
          <span class="source-badge ${isEnabled ? 'enabled' : 'disabled'}">
            ${isEnabled ? 'BẬT' : 'TẮT'}
          </span>
        </div>
      </div>
      <div class="source-actions">
        ${isEnabled
                ? `<button class="btn-disable" onclick="toggleSource('${sourceId}', false)">
              <i class="fas fa-toggle-off"></i> Tắt
            </button>`
                : `<button class="btn-enable" onclick="toggleSource('${sourceId}', true)">
              <i class="fas fa-toggle-on"></i> Bật
            </button>`
            }
      </div>
    `;
        sourcesGrid.appendChild(card);
    });
}

// Get source display name
function getSourceName(sourceId) {
    const names = {
        'tmail': 'TMail',
        'tempmail-id': 'TempMail.ID',
        'noopmail': 'NoopMail',
        'temporarymail': 'TemporaryMail',
        'mailio': 'Mail.io',
        'pmail': 'PMail (IMAP)',
        'etempmail': 'eTempMail',
        'tinyhost': 'TinyHost',
        'edumail': 'EduMail',
        'apple': 'Apple.edu',
        'generatoremail': 'Generator.email',
        'moakt': 'Moakt.com',
        'tempmailapi': 'TempMailAPI',
        'livewire': 'Livewire'
    };
    return names[sourceId] || sourceId;
}

// Toggle source
async function toggleSource(sourceId, enabled) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/toggle-source`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceId, enabled })
        });

        const result = await response.json();

        if (result.success) {
            showAlert('adminAlert', `Đã ${enabled ? 'bật' : 'tắt'} nguồn ${getSourceName(sourceId)}!`, 'success');
            loadConfig();
        } else {
            showAlert('adminAlert', result.error || 'Có lỗi xảy ra!', 'error');
        }
    } catch (error) {
        showAlert('adminAlert', 'Lỗi: ' + error.message, 'error');
    }
}

// Set default source
async function setDefaultSource() {
    const sourceId = document.getElementById('defaultSourceSelect').value;

    if (!sourceId) {
        showAlert('adminAlert', 'Vui lòng chọn nguồn!', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/set-default`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceId })
        });

        const result = await response.json();

        if (result.success) {
            showAlert('adminAlert', `Đã đặt ${getSourceName(sourceId)} làm nguồn mặc định!`, 'success');
            loadConfig();
        } else {
            showAlert('adminAlert', result.error || 'Có lỗi xảy ra!', 'error');
        }
    } catch (error) {
        showAlert('adminAlert', 'Lỗi: ' + error.message, 'error');
    }
}


// Show alert
function showAlert(elementId, message, type) {
    const alert = document.getElementById(elementId);
    alert.textContent = message;
    alert.className = `alert ${type} show`;

    setTimeout(() => {
        alert.classList.remove('show');
    }, 3000);
}

// Enter key to login
document.getElementById('password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        login();
    }
});

// Announcement: load current announcement into textarea (admin panel)
async function loadAnnouncement() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/announcement`);
        const result = await response.json();
        if (result.success) {
            document.getElementById('announcementText').value = result.announcement || '';
        } else {
            showAlert('adminAlert', 'Không thể tải thông báo', 'error');
        }
    } catch (error) {
        showAlert('adminAlert', 'Lỗi: ' + error.message, 'error');
    }
}

// Announcement: save announcement from textarea
async function saveAnnouncement() {
    const announcement = document.getElementById('announcementText').value || '';
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/announcement`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ announcement })
        });
        const result = await response.json();
        if (result.success) {
            showAlert('adminAlert', 'Lưu thông báo thành công', 'success');
        } else {
            showAlert('adminAlert', result.error || 'Lỗi khi lưu', 'error');
        }
    } catch (error) {
        showAlert('adminAlert', 'Lỗi: ' + error.message, 'error');
    }
}

// Load announcement on admin panel open
if (sessionStorage.getItem('adminLoggedIn') === 'true') {
    loadAnnouncement();
}
