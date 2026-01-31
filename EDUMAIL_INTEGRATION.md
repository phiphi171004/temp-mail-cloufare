# EduMail Integration - Hoàn tất ✅

## Tổng quan
Đã thành công integrate nguồn **EduMail (edumailfree.com)** vào TempMail server với đầy đủ tính năng.

## Các file đã thay đổi

### 1. Backend

#### `src/edumail-client.js` (MỚI)
- Client để tương tác với edumailfree.com API
- Sử dụng Livewire framework (giống TMail)
- Hỗ trợ:
  - Initialize session và parse snapshots
  - Tạo email với username tùy chỉnh
  - Tạo email ngẫu nhiên
  - Fetch messages
  - Sync email
  - Proxy support (ScraperAPI)

#### `src/mail-source-manager.js`
- Import `EduMailClient`
- Thêm 'edumail' vào `sources` object
- Thêm case 'edumail' trong `initSource()`
- Update logic load domains

#### `src/tempmail.js`
- Thêm `createEmailEduMail()` - Tạo email với username
- Thêm `fetchMessagesEduMail()` - Lấy messages
- Update `createEmail()` - Xử lý case 'edumail'
- Update `createRandomEmail()` - Hỗ trợ edumail
- Update `fetchMessages()` - Xử lý case 'edumail'
- Update `syncEmailOnReload()` - Sync email khi reload
- Update `syncAndFetchAfterCreate()` - Hỗ trợ edumail

#### `src/database.js`
- Update `defaultConfig` để thêm `edumail: true` vào `enabledSources`

### 2. Frontend

#### `src/public/app.js`
- Thêm `'edumail': 'EduMail'` vào `sourceNames` mapping trong `loadEnabledSources()`
- Update logic sync email để hỗ trợ edumail (4 chỗ):
  - Init function (khi reload)
  - createEmailFromModal
  - createRandomEmail
  - createRandomEmailManual

### 3. Database
- Đã update config trong Supabase thành công
- `enabledSources.edumail = true`

## Tính năng EduMail

### Domains (26 domains giáo dục)
```
academic.edu.rs, semar.edu.pl, gng.edu.pl, agp.edu.pl,
gold.edu.pl, bcm.edu.pl, id.semar.edu.pl, dev.semar.edu.pl,
student.semar.edu.pl, teacher.semar.edu.pl, portal.academic.edu.rs,
contact.academic.edu.rs, students.academic.edu.rs, library.gng.edu.pl,
research.gng.edu.pl, exams.gng.edu.pl, lab.agp.edu.pl,
up.agp.edu.pl, campus.agp.edu.pl, prime.gold.edu.pl,
student.gold.edu.pl, elite.gold.edu.pl, dev.bcm.edu.pl,
webmail.bcm.edu.pl, hr.bcm.edu.pl, student.neonet.ac.nz
```

### Chức năng
- ✅ Tạo email với username tùy chỉnh (3-15 ký tự)
- ✅ Tạo email ngẫu nhiên
- ✅ Fetch messages (real-time)
- ✅ Sync email khi reload
- ✅ Hỗ trợ proxy (ScraperAPI)
- ✅ Format messages đồng nhất với các nguồn khác
- ✅ Parse date và datediff
- ✅ Xử lý attachments

## Test

### Test script: `test-edumail.js`
```bash
node test-edumail.js
```

Kết quả test:
- ✅ Initialize: OK
- ✅ Get domains: 26 domains
- ✅ Create random email: OK
- ✅ Fetch messages: OK

### Update database script: `update-db-config.js`
```bash
node update-db-config.js
```

Kết quả:
- ✅ Config đã có edumail trong database

## API Response

### `/api/sources/enabled`
```json
{
  "success": true,
  "sources": ["pmail", "edumail", "noopmail", "tinyhost", "etempmail", "temporarymail"],
  "defaultSource": "noopmail"
}
```

## Cách sử dụng

1. **Chọn nguồn EduMail** từ dropdown "Nguồn"
2. **Tạo email mới**:
   - Click "Tạo Email Mới" để tạo với username tùy chỉnh
   - Click "Tạo Email Ngẫu Nhiên" để tạo tự động
3. **Nhận thư**: Messages sẽ tự động refresh mỗi 10 giây

## Lưu ý kỹ thuật

### Livewire Framework
EduMail sử dụng Livewire framework giống TMail:
- Component snapshots (actions, app)
- Checksum validation
- DOM morphing
- Wire directives

### Session Management
**EduMail HỖ TRỢ reload session** bằng cách lưu cookies vào localStorage.

Cách hoạt động:
1. Khi tạo email: Lưu cookies vào localStorage (`edumailCookies`)
2. Khi reload: Restore cookies → GET `/mailbox` → syncEmail → fetchMessages
3. Cookies chứa session ID để server nhận diện email cũ

Giống như web gốc edumailfree.com:
- Cookies được lưu trong browser
- Khi reload, cookies được gửi lại để khôi phục session
- Email cũ được load lại từ server

### Sync Logic
EduMail cần sync email sau khi tạo (giống TMail):
```javascript
// Sau khi tạo email
await this.syncAndFetchAfterCreate();

// Khi reload - KHÔNG hỗ trợ
// throw new Error('Session đã hết hạn. Vui lòng tạo email mới.');
```

### Frontend Integration
Frontend **KHÔNG** sync edumail khi reload:
```javascript
// Init function - edumail KHÔNG có trong list
if (
  source === 'tmail' ||
  source === 'noopmail' ||
  source === 'temporarymail' ||
  // ... (không có edumail)
) {
  await apiCall('/api/email/sync', 'POST', { email, secretKey, token });
}
```

## Troubleshooting

### Dropdown không hiển thị EduMail
- ✅ Đã fix: Thêm `'edumail': 'EduMail'` vào `sourceNames` mapping

### Lỗi 500 khi fetch messages
- ✅ Đã fix: Fetch lại HTML sau khi tạo email để update snapshot app

### Email không sync khi reload
- ✅ Đã fix: EduMail HỖ TRỢ reload bằng cách lưu cookies vào localStorage

## Hành vi đặc biệt

### Session Management với Cookies + CSRF Token
✅ **EduMail HỖ TRỢ reload session đầy đủ** (giống TMail)

**Dữ liệu được lưu:**
- Cookies (XSRF-TOKEN, tmail_session)
- CSRF Token (_token)

**Flow reload:**
1. **Tạo email**: Lưu `{cookies, csrfToken}` vào localStorage
2. **Reload**: Frontend gửi cookies qua API `/api/email/sync`
3. **Server**: Restore cookies + CSRF token vào client
4. **Client**: 
   - GET `/mailbox` với cookies → Lấy snapshot (có email cũ)
   - syncEmail + fetchMessages với CSRF token
5. **Kết quả**: Email cũ được load lại thành công!

**Ví dụ cookies được lưu:**
```json
{
  "cookies": {
    "XSRF-TOKEN": "eyJpdiI6...",
    "tmail_session": "eyJpdiI6..."
  },
  "csrfToken": "E6tD5AG0mupDu201BloKX4aBTORHDMLryLsvPjnm"
}
```

## Kết luận

EduMail đã được integrate hoàn chỉnh và sẵn sàng sử dụng! 🎉

- ✅ Backend: Hoàn tất
- ✅ Frontend: Hoàn tất
- ✅ Database: Hoàn tất
- ✅ Testing: Thành công
