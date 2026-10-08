# 🎰 HƯỚNG DẪN QUẢN LÝ BẬT / TẮT CHỨC NĂNG SÒNG BẠC ST25

Tài liệu này ghi chú chi tiết về trạng thái của tính năng **Sòng Bạc ST25** (Tài Xỉu Gateway, Bầu Cua Dino & Đua Khủng Long Derby).

> **LƯU Ý QUAN TRỌNG:**  
> **Toàn bộ mã nguồn Sòng Bạc KHÔNG HỀ BỊ XÓA!**  
> Toàn bộ giao diện, âm thanh, hiệu ứng xóc đĩa, hoạt cảnh đua thú, thuật toán xác suất và logic backend vẫn được bảo toàn nguyên vẹn 100%. Tính năng hiện chỉ đang ở trạng thái **TẮT (DISABLED)** theo yêu cầu.

---

## 📌 1. HIỆN TẠI ĐANG TẮT NHỮNG GÌ?

| Thành phần | Trạng thái hiện tại | Vị trí file |
| :--- | :--- | :--- |
| **Công tắc tổng (Master Switch)** | `"enabled": false` | `server-config.json` |
| **API Backend (`/api/casino/*`)** | Chặn toàn bộ, trả về mã 404 Disabled | `server.js` (dòng 4560) |
| **Đường dẫn `/song-bac.html`** | Tự động chuyển hướng về trang chủ (`/`) | `server.js` (dòng 23) & `song-bac.html` |
| **Menu điều hướng Desktop** | Đã ẩn mục Sòng Bạc khỏi nhóm "Kinh Tế & Chợ" | `assets/js/app.js` (dòng 195) |
| **Menu Mobile Drawer** | Đã ẩn mục Sòng Bạc khỏi menu trượt trên điện thoại | `assets/js/app.js` (dòng 420) |
| **Nút bấm Trang Chủ** | Đã ẩn nút "🎲 Sòng Bạc ST25" ở phần Hero Actions | `index.html` (dòng 90) |

---

## 🟢 2. HƯỚNG DẪN BẬT LẠI SÒNG BẠC KHI CẦN

Khi bạn muốn mở lại Sòng Bạc cho người chơi, chỉ cần thực hiện 2 bước đơn giản sau:

### Bước 1: Bật công tắc trong file `server-config.json`
Mở file `server-config.json`, tìm dòng `"casino"` và đổi `"enabled": false` thành `"enabled": true`:

```json
"casino": {
  "enabled": true,
  "maintenance_message": "Tính năng Sòng Bạc ST25 hiện đang tạm thời đóng để bảo trì & cân bằng hệ thống. Vui lòng quay lại sau!"
}
```
*(Server sẽ tự động nhận diện cấu hình mới ngay lập tức mà không bắt buộc phải sửa code server)*.

---

### Bước 2: Hiển thị lại nút bấm và menu

1. **Trong file `assets/js/app.js`:**
   - Tìm đoạn `<!-- [TẮT TẠM THỜI] Bỏ comment dòng dưới khi muốn bật lại Sòng Bạc:`
   - Bỏ comment (xóa `<!--` và `-->`) thẻ `<a>` cho cả Desktop Menu và Mobile Drawer.

2. **Trong file `index.html`:**
   - Tìm đoạn `<!-- [TẮT TẠM THỜI] Bỏ comment nút dưới khi muốn bật lại Sòng Bạc:` ở phần Hero Section.
   - Bỏ comment thẻ `<a>` để nút "🎲 Sòng Bạc ST25" xuất hiện lại trên trang chủ.

---

## 📂 3. DANH SÁCH FILE LIÊN QUAN ĐƯỢC BẢO TOÀN

1. **`song-bac.html` (Còn nguyên vẹn 100%):**
   - Minigame 1: **Tài Xỉu Gateway (Sicbo)** — Đầy đủ xí ngầu 3D, xóc đĩa, âm thanh lắc bát, bảng soi cầu.
   - Minigame 2: **Bầu Cua ST25** — Đầy đủ 6 linh vật: Rex, Trike, Deino, Cua, Gà, Ếch.
   - Minigame 3: **Đua Khủng Long (Dino Derby)** — Đầy đủ đường đua 5 chiến mã, animation chạy đua thời gian thực, bình luận viên.
   - Đồng bộ ví Lúa thời gian thực và Kho Bạc Làng ST25.

2. **`server.js` (Còn nguyên vẹn 100%):**
   - Thuật toán xác suất Tài Xỉu (30% người chơi / 70% nhà cái để thu hồi Lúa).
   - Thuật toán Bầu Cua thông minh.
   - Thuật toán Đua Khủng Long có trọng số thể lực & tốc độ từng loài.
   - Khóa Mutex chống click spam & race condition dup Lúa.
