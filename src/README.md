# Cấu trúc mã nguồn ST25

Dự án dùng Express và HTML/JavaScript thuần, tổ chức theo hướng MVC.

```text
src/
  app.js                 Khởi tạo Express và middleware
  core/
    config.js            Đường dẫn, cổng và cấu hình máy chủ
    server-config.json   Cấu hình vận hành, chỉ máy chủ đọc
    web-config.js        Cấu hình công khai cho trình duyệt
    auth.js              Phiên đăng nhập và xác thực
  api/
    endpoints.js         Danh sách URL API dùng trong giao diện
    islepilot.js         Gọi API IslePilot, cache và timeout
  routes/
    pages.js             Định tuyến trang và điều kiện truy cập
    legacy-assets.js     Tương thích URL script cũ
  controllers/
    pages.js             Ghép layout và đánh dấu menu hiện tại
    portal.js            Xử lý các chức năng API của portal
  models/
    config.js            Đọc/ghi cấu hình vận hành
    portal-data.js       Đọc/ghi dữ liệu portal
    data/portal-data.json
  pages/                 Các giao diện HTML
  views/partials/
    header.html          Header dùng chung
    footer.html          Footer dùng chung
  features/
    shared/              App, UI và hiệu ứng dùng chung
    home/                Thông tin người chơi ở trang chủ
    map/                 Bản đồ
    gara/                Gara
    skin/                Chỉnh skin và mô hình 3D
    nhiem-vu/             Nhiệm vụ
    .../                 JavaScript riêng cho từng trang
```

Chạy `npm start`, truy cập `http://localhost:3000`. Các URL cũ như `/gara.html` vẫn giữ nguyên. Truy cập qua Express để header/footer được ghép vào trang; mở trực tiếp HTML bằng `file://` không thực hiện bước ghép này.

Sửa menu hoặc footer tại `views/partials`, không sao chép lại vào từng trang. Trang mới đặt ở `pages`, dùng `<!-- include:header -->` và `<!-- include:footer -->`. Thêm script cấu hình web và API trong `<head>` trước script chức năng. JavaScript riêng đặt tại `features/<chức-năng>/` rồi tham chiếu bằng URL `/src/features/...`.

Khi thêm API cho giao diện, khai báo đường dẫn tại `api/endpoints.js` và dùng `API.<tên>` trong JavaScript. Chỉ cấu hình công khai được đặt trong `core/web-config.js`; token và cấu hình máy chủ nằm trong biến môi trường hoặc `core/server-config.json`.

CSS, ảnh, font và thư viện bên ngoài vẫn nằm trong `assets`. Bốn trang `islepilot_*` là bản HTML tham khảo đã có, được gom vào `pages` và giữ nội dung xuất gốc.

`npm test` chạy các kiểm tra hiện có và kiểm tra cấu trúc mới. Kiểm tra cấu trúc xác nhận trang render đủ layout, script tải được, menu đánh dấu trang hiện tại và các file riêng tư không được phục vụ công khai.
