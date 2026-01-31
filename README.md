# 📧 TempMail Node.js




Dự án tạo email tạm thời và nhận thư sử dụng Node.js, kết nối với API của tmail.mmocommunity.io.vn

## ✨ Tính năng

- ✅ Tạo email tạm thời với username tùy chỉnh
- ✅ Tạo email ngẫu nhiên
- ✅ Nhận và đọc thư
- ✅ Hỗ trợ nhiều domain khác nhau
- ✅ CLI interface đẹp mắt
- ✅ Web UI đơn giản, hiện đại
- ✅ Auto-refresh hộp thư mỗi 10 giây
- ✅ API REST để tích hợp

## 📦 Cài đặt

### Yêu cầu
- Node.js >= 16.0.0
- npm hoặc yarn
- ScraperAPI key (miễn phí 5,000 requests/tháng) - **CHỈ CẦN khi deploy lên Render.com**
  - **Railway.app: KHÔNG CẦN ScraperAPI!** ✅

### Bước 1: Clone hoặc tải project

```bash
git clone <your-repo-url>
cd teamp-mail
```

### Bước 2: Cài đặt dependencies

```bash
npm install
```

### Bước 3: Cấu hình (Optional - cho production)

Tạo file `.env` (copy từ `.env.example`):

```bash
# Railway.app - KHÔNG CẦN ScraperAPI! ✅
USE_PROXY=false
PORT=3000

# Render.com - CẦN ScraperAPI ⚠️
# USE_PROXY=true
# SCRAPERAPI_KEY=your_api_key_here
# PORT=3000
```

**Lấy ScraperAPI key (CHỈ CẦN CHO RENDER.COM):**
1. Đăng ký tại: https://www.scraperapi.com/
2. Free tier: 5,000 requests/tháng
3. Copy API key từ dashboard

## 🚀 Sử dụng

### ⚙️ Modes

Ứng dụng hỗ trợ 2 modes:

**1. Direct Mode (Local Development)**
- Gửi requests trực tiếp đến API gốc
- Không cần ScraperAPI
- Hoạt động tốt trên máy local
- Set `USE_PROXY=false` hoặc không set

**2. Proxy Mode (Render.com)**
- Route requests qua ScraperAPI để bypass Cloudflare
- Cần ScraperAPI key
- **CHỈ CẦN khi deploy lên Render.com**
- Set `USE_PROXY=true` và `SCRAPERAPI_KEY=your_key`
- **Railway.app: KHÔNG CẦN!** Dùng Direct Mode (`USE_PROXY=false`)

### 1️⃣ CLI Mode (Command Line Interface)

Chạy CLI để tạo và quản lý email tạm:

```bash
npm start
```

Hoặc:

```bash
node src/cli.js
```

**Các chức năng CLI:**
- 📝 Tạo email tùy chỉnh
- 🎲 Tạo email ngẫu nhiên
- 📬 Xem hộp thư
- 🔄 Làm mới hộp thư
- 🌐 Đổi domain
- 📋 Danh sách email đã tạo
- 🗑️ Xóa email hiện tại

### 2️⃣ Web UI Mode

Chạy web server:

```bash
npm run server
```

Sau đó mở trình duyệt và truy cập: `http://localhost:3000`

**Tính năng Web UI:**
- Giao diện đẹp, responsive, hiện đại
- Tự động tạo email khi vào trang
- Tạo email với username tùy chỉnh (modal)
- Tạo email ngẫu nhiên
- Tự động làm mới hộp thư mỗi 10 giây
- Copy email nhanh chóng
- Xem chi tiết thư full-screen
- Xóa email dễ dàng

### 3️⃣ API Mode (Tích hợp vào dự án khác)

```javascript
import { TempMail } from './src/tempmail.js';

const tempMail = new TempMail();

// Khởi tạo
await tempMail.init();

// Tạo email
const result = await tempMail.createEmail('myusername');
console.log(result.email); // myusername@mmocommunity.io.vn

// Lấy thư
const messages = await tempMail.fetchMessages();
console.log(messages);

// Tạo email ngẫu nhiên
const random = await tempMail.createRandomEmail();
console.log(random.email);
```

## 📡 REST API Documentation

Base URL: `http://localhost:3000`

Tất cả API requests cần có header `X-Session-ID` để quản lý session (optional, mặc định là `'default'`).

### Authentication

**Header:**
```
X-Session-ID: your-unique-session-id (optional)
Content-Type: application/json
```

---

### 1. GET `/api/domains`

Lấy danh sách tất cả các domain có sẵn.

**Request:**
```http
GET /api/domains
Headers:
  X-Session-ID: web-1234567890-abc123 (optional)
```

**Response (Success):**
```json
{
  "success": true,
  "domains": [
    "mmocommunity.io.vn",
    "befhopcharity.io.vn",
    "ramcloud.us",
    "ramcloud.site",
    "newramcloud.org",
    "ramcloud.net",
    "ram-cloud.org",
    "newcentury-ai.xyz",
    "ramcloud.me",
    "ramcloud.store",
    "cloudsram.me",
    "voicon.edu.vn",
    "vuk.edu.vn",
    "spzoi10.edu.pl"
  ]
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Error message"
}
```

---

### 2. POST `/api/init`

Khởi tạo session, kết nối với server temp mail và lấy CSRF token.

**Request:**
```http
POST /api/init
Headers:
  X-Session-ID: web-1234567890-abc123 (optional)
  Content-Type: application/json
```

**Payload:** Không cần body

**Response (Success):**
```json
{
  "success": true,
  "message": "Session initialized"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Error message"
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error

---

### 3. POST `/api/email/create`

Tạo email mới với username tùy chỉnh.

**Request:**
```http
POST /api/email/create
Headers:
  X-Session-ID: web-1234567890-abc123 (optional)
  Content-Type: application/json
```

**Payload:**
```json
{
  "username": "myemail123",
  "domain": "mmocommunity.io.vn"
}
```

**Payload Fields:**
- `username` (required, string, 3-15 ký tự): Tên người dùng cho email
- `domain` (optional, string): Domain để tạo email. Nếu không có, dùng domain mặc định

**Response (Success):**
```json
{
  "success": true,
  "email": "myemail123@mmocommunity.io.vn",
  "message": "Email tạm đã được tạo: myemail123@mmocommunity.io.vn"
}
```

**Response (Error - Validation):**
```json
{
  "success": false,
  "error": "Username phải có ít nhất 3 ký tự"
}
```
```json
{
  "success": false,
  "error": "Username không được vượt quá 15 ký tự"
}
```

**Response (Error - Missing Username):**
```json
{
  "success": false,
  "error": "Username is required"
}
```

**Response (Error - Server):**
```json
{
  "success": false,
  "error": "Error message from server"
}
```

**Status Codes:**
- `200`: Success
- `400`: Bad request (thiếu username hoặc validation failed)
- `500`: Server error

**Ví dụ với cURL:**
```bash
curl -X POST http://localhost:3000/api/email/create \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: web-1234567890-abc123" \
  -d '{
    "username": "myemail123",
    "domain": "mmocommunity.io.vn"
  }'
```

---

### 4. POST `/api/email/random`

Tạo email ngẫu nhiên tự động (không cần username).

**Request:**
```http
POST /api/email/random
Headers:
  X-Session-ID: web-1234567890-abc123 (optional)
  Content-Type: application/json
```

**Payload:** Không cần body

**Response (Success):**
```json
{
  "success": true,
  "email": "mhjc1c2jgwu1qu@mmocommunity.io.vn",
  "message": "Email tạm đã được tạo: mhjc1c2jgwu1qu@mmocommunity.io.vn"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Error message from server"
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error

**Ví dụ với cURL:**
```bash
curl -X POST http://localhost:3000/api/email/random \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: web-1234567890-abc123"
```

---

### 5. GET `/api/messages`

Lấy danh sách tất cả thư trong hộp thư của email hiện tại.

**Request:**
```http
GET /api/messages
Headers:
  X-Session-ID: web-1234567890-abc123 (optional)
```

**Payload:** Không cần body

**Response (Success):**
```json
{
  "success": true,
  "messages": [
    {
      "id": 21025,
      "subject": "Your login code to VEED: 31965",
      "sender_name": "VEED",
      "sender_email": "noreply@login.veed.io",
      "date": "03 Nov 2025 03:27 PM",
      "datediff": "39 giây trước",
      "timestamp": "2025-11-03T15:27:37+00:00",
      "content": "<formatted HTML content>",
      "content_raw": "<original HTML content>",
      "attachments": []
    },
    {
      "id": 21023,
      "subject": "dfsdf",
      "sender_name": "Quý Đỗ Văn",
      "sender_email": "admins@anything.playmaker.id.vn",
      "date": "03 Nov 2025 10:26 PM",
      "datediff": "1 phút trước",
      "timestamp": "2025-11-03T22:26:26+07:00",
      "content": "<formatted HTML content>",
      "content_raw": "<original HTML content>",
      "attachments": []
    }
  ],
  "count": 2
}
```

**Response Fields:**
- `success` (boolean): Trạng thái request
- `messages` (array): Danh sách thư
  - `id` (number): ID của thư
  - `subject` (string): Tiêu đề thư
  - `sender_name` (string): Tên người gửi
  - `sender_email` (string): Email người gửi
  - `date` (string): Ngày giờ định dạng (vd: "03 Nov 2025 03:27 PM")
  - `datediff` (string): Thời gian tương đối (vd: "39 giây trước")
  - `timestamp` (string): Timestamp ISO
  - `content` (string): Nội dung thư đã được format (HTML đã được clean)
  - `content_raw` (string): Nội dung thư gốc (HTML nguyên bản)
  - `attachments` (array): Danh sách file đính kèm
- `count` (number): Số lượng thư

**Response (Error - No Email):**
```json
{
  "success": false,
  "error": "Chưa có email nào được chọn"
}
```

**Response (Error - Server):**
```json
{
  "success": false,
  "error": "Error message from server"
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error

**Ví dụ với cURL:**
```bash
curl -X GET http://localhost:3000/api/messages \
  -H "X-Session-ID: web-1234567890-abc123"
```

---

### 6. GET `/api/email/current`

Lấy thông tin email hiện tại và danh sách tất cả email đã tạo trong session.

**Request:**
```http
GET /api/email/current
Headers:
  X-Session-ID: web-1234567890-abc123 (optional)
```

**Payload:** Không cần body

**Response (Success):**
```json
{
  "success": true,
  "email": "myemail123@mmocommunity.io.vn",
  "emails": [
    "myemail123@mmocommunity.io.vn",
    "another@mmocommunity.io.vn"
  ]
}
```

**Response Fields:**
- `success` (boolean): Trạng thái request
- `email` (string|null): Email hiện tại đang được sử dụng
- `emails` (array): Danh sách tất cả email đã tạo trong session

**Ví dụ với cURL:**
```bash
curl -X GET http://localhost:3000/api/email/current \
  -H "X-Session-ID: web-1234567890-abc123"
```

---

### 7. DELETE `/api/email`

Xóa email hiện tại.

**Request:**
```http
DELETE /api/email
Headers:
  X-Session-ID: web-1234567890-abc123 (optional)
```

**Payload:** Không cần body

**Response (Success):**
```json
{
  "success": true,
  "message": "Đã xóa email: myemail123@mmocommunity.io.vn"
}
```

**Response (Error - No Email):**
```json
{
  "success": false,
  "error": "Chưa có email nào được chọn"
}
```

**Response (Error - Server):**
```json
{
  "success": false,
  "error": "Error message from server"
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error

**Ví dụ với cURL:**
```bash
curl -X DELETE http://localhost:3000/api/email \
  -H "X-Session-ID: web-1234567890-abc123"
```

---

### 8. POST `/api/domain`

Đổi domain cho các email được tạo sau đó.

**Request:**
```http
POST /api/domain
Headers:
  X-Session-ID: web-1234567890-abc123 (optional)
  Content-Type: application/json
```

**Payload:**
```json
{
  "domain": "befhopcharity.io.vn"
}
```

**Payload Fields:**
- `domain` (required, string): Domain muốn sử dụng (phải có trong danh sách domains)

**Response (Success):**
```json
{
  "success": true,
  "domain": "befhopcharity.io.vn"
}
```

**Response (Error - Missing Domain):**
```json
{
  "success": false,
  "error": "Domain is required"
}
```

**Response (Error - Invalid Domain):**
```json
{
  "success": false,
  "error": "Domain không hợp lệ"
}
```

**Status Codes:**
- `200`: Success
- `400`: Bad request (thiếu domain hoặc domain không hợp lệ)
- `500`: Server error

**Ví dụ với cURL:**
```bash
curl -X POST http://localhost:3000/api/domain \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: web-1234567890-abc123" \
  -d '{
    "domain": "befhopcharity.io.vn"
  }'
```

---

### 9. GET `/api/stats`

Lấy thống kê usage của ScraperAPI (chỉ khi USE_PROXY=true).

**Request:**
```http
GET /api/stats
```

**Response (Proxy Mode):**
```json
{
  "success": true,
  "proxyEnabled": true,
  "stats": {
    "totalRequests": 150,
    "successfulRequests": 148,
    "failedRequests": 2,
    "totalResponseTime": 45000,
    "averageResponseTime": 304,
    "successRate": 99,
    "remainingQuota": 4850,
    "lastReset": "2025-11-22T10:00:00.000Z",
    "errors": []
  },
  "message": "ScraperAPI is enabled"
}
```

**Response (Direct Mode):**
```json
{
  "success": true,
  "proxyEnabled": false,
  "stats": null,
  "message": "Direct mode (no proxy)"
}
```

---

### 10. GET `/health`

Health check endpoint để monitoring.

**Request:**
```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "mode": "proxy",
  "uptime": 3600.5,
  "stats": {
    "totalRequests": 150,
    "successRate": 99,
    "remainingQuota": 4850
  }
}
```

---

## 🔄 Flow sử dụng API thông thường

### 1. Khởi tạo và tạo email:
```javascript
// 1. Khởi tạo session
POST /api/init

// 2. Lấy danh sách domains (optional)
GET /api/domains

// 3. Tạo email (chọn 1 trong 2)
POST /api/email/create  // Với username tùy chỉnh
// HOẶC
POST /api/email/random   // Email ngẫu nhiên
```

### 2. Lấy thư:
```javascript
// Lấy danh sách thư
GET /api/messages

// Kiểm tra email hiện tại
GET /api/email/current
```

### 3. Quản lý email:
```javascript
// Xóa email
DELETE /api/email

// Đổi domain
POST /api/domain
```

---

## 🌐 Danh sách Domains hỗ trợ

- mmocommunity.io.vn (mặc định)
- befhopcharity.io.vn
- ramcloud.us
- ramcloud.site
- newramcloud.org
- ramcloud.net
- ram-cloud.org
- newcentury-ai.xyz
- ramcloud.me
- ramcloud.store
- cloudsram.me
- voicon.edu.vn
- vuk.edu.vn
- spzoi10.edu.pl

---

## 📁 Cấu trúc Project

```
teamp-mail/
├── src/
│   ├── config.js           # Cấu hình (URL, domains, headers)
│   ├── livewire-client.js  # Client kết nối với Livewire API
│   ├── tempmail.js         # Service chính
│   ├── cli.js              # CLI interface
│   ├── server.js           # Express server (REST API)
│   ├── public/
│   │   └── index.html      # Web UI
│   ├── example.js          # Ví dụ sử dụng programmatically
│   └── test.js             # Test file
├── package.json
├── README.md
└── .gitignore
```

---

## 🛠️ Development

### Chạy server với auto-reload:
```bash
npm run dev
```

### Chạy server thông thường:
```bash
npm run server
```

### Chạy CLI:
```bash
npm start
```

### Test:
```bash
npm test
```

---

## 🚀 Deploy Lên Hosting

### ⚠️ Lưu Ý Quan Trọng

**Railway.app: KHÔNG CẦN ScraperAPI!** ✅
- Railway có IP tốt, không bị Cloudflare chặn
- Chỉ cần set `USE_PROXY=false` hoặc không set
- Chạy trực tiếp (Direct Mode) - nhanh và miễn phí!

**Render.com: CẦN ScraperAPI** ⚠️
- IP của Render bị Cloudflare chặn
- Phải dùng Proxy Mode với ScraperAPI
- Set `USE_PROXY=true` + `SCRAPERAPI_KEY`

### 🔄 Hai Modes Hoạt Động

| Mode | Khi nào dùng | Cần proxy? | Performance |
|------|--------------|------------|-------------|
| **Direct** | Local, Railway | ❌ Không | ⚡ Nhanh (100-300ms) |
| **Proxy** | Render, Vercel | ✅ Cần | 🔄 Chậm hơn (1-3s) |

**Setup nhanh:**
- **Local/Railway**: `USE_PROXY=false` (hoặc không set) → Direct Mode
- **Render**: `USE_PROXY=true` + `SCRAPERAPI_KEY` → Proxy Mode

📖 **Chi tiết:** Xem [PROXY-SETUP.md](./PROXY-SETUP.md)

### Quick Deploy

**Railway.app (Khuyên dùng - KHÔNG CẦN ScraperAPI!):**
1. Fork/Clone repo này
2. Tạo project trên Railway: https://railway.app/
3. Connect GitHub repo
4. Set environment variable (optional):
   - `USE_PROXY=false` (hoặc không set)
5. Deploy! ✅

**Render.com (CẦN ScraperAPI):**
1. Fork/Clone repo này
2. Đăng ký ScraperAPI (free): https://www.scraperapi.com/
3. Tạo Web Service trên Render: https://render.com/
4. Set environment variables:
   - `SCRAPERAPI_KEY`: your_api_key
   - `USE_PROXY`: true
5. Deploy!

**Chi tiết từng bước:** Xem file [DEPLOY.md](./DEPLOY.md)

### Các Platform Hỗ Trợ

- ✅ **Railway.app** (Free tier) - **Khuyên dùng - KHÔNG CẦN ScraperAPI!**
- ✅ Render.com (Free tier) - Cần ScraperAPI
- ✅ Fly.io - Test thử, có thể không cần proxy
- ✅ Heroku - Cần ScraperAPI
- ⚠️ Vercel (Cần config cho serverless)

---

## 📝 Lưu ý

1. **Session Management**: Mỗi session ID sẽ có một instance TempMail riêng. Nếu không truyền `X-Session-ID`, tất cả requests sẽ dùng session `'default'`.

2. **Username Validation**: Username phải từ 3-15 ký tự.

3. **Auto-refresh**: Web UI tự động refresh mỗi 10 giây khi có email.

4. **Content Format**: 
   - `content`: HTML đã được format (loại bỏ script, style, tracking pixels)
   - `content_raw`: HTML gốc từ server

5. **CORS**: Server đã cấu hình CORS để cho phép requests từ mọi origin (production nên restrict lại).

6. **ScraperAPI Usage**:
   - Free tier: 5,000 requests/tháng
   - Mỗi email tạo: ~3-4 requests
   - Mỗi lần fetch messages: ~1 request
   - Ước tính: ~100-150 emails/tháng với free tier

7. **Proxy Mode**:
   - **Railway**: KHÔNG CẦN proxy (set `USE_PROXY=false`)
   - **Render**: CẦN proxy (set `USE_PROXY=true` + `SCRAPERAPI_KEY`)
   - Local development không cần proxy
   - Kiểm tra mode qua `/health` endpoint

---

## 🐛 Troubleshooting

### Lỗi 500 Internal Server Error
- Kiểm tra kết nối internet
- Đảm bảo đã gọi `/api/init` trước khi tạo email
- Kiểm tra username có hợp lệ (3-15 ký tự)

### Lỗi "Chưa có email nào được chọn"
- Phải tạo email trước khi lấy messages
- Kiểm tra session ID có đúng không

### Email không nhận được thư
- Kiểm tra email đã được tạo thành công chưa
- Thử refresh messages
- Đảm bảo đã đợi đủ thời gian để server nhận thư

---

## 📄 License

MIT

---

## 👨‍💻 Author

TempMail Node.js - Temporary Email Service
