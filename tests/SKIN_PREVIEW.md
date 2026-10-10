# Skin preview hiện tại

Trang Skin dùng minh họa chuyển động 2D cho Triceratops, Troodon và Tyrannosaurus. Phần mô hình 3D và thanh chỉnh độ trưởng thành đã được bỏ. Loài chưa có ảnh dùng bản phối màu SVG 2D.

File gốc nằm trong `src/pages/illustrations/`. Renderer `src/views/illustration.js` giữ nguyên bản gốc trên đĩa và thêm adapter phối màu khi nhúng vào trang Skin.

`assets/js/skin-illustration-palette.js` xác định vùng thân, hoa văn, hông, bụng, chi tiết, display, mắt, răng, miệng và móng bằng tọa độ riêng từng loài. Vùng màu này là gần đúng trên ảnh; ảnh không có UV/texture mask từ game. Một số vùng rất nhỏ hoặc bị che khuất trong ảnh. Đổi màu giữ độ sáng và chi tiết ảnh, không xác nhận kết quả màu chính xác trong The Isle.

`assets/js/skin-illustrations.js` gửi palette vào iframe khi đổi màu, reset, preset hoặc nhập mã. Iframe dùng sandbox và chỉ xử lý thông điệp của trang cha. Ảnh chỉ tải khi khung preview xuất hiện; hủy iframe khi đổi loài, ẩn workspace, cuộn ra ngoài hoặc ẩn tab.

## Kiểm tra

`npm test` kiểm tra API, các route ảnh, script nhúng, cấu trúc, preset và chức năng có sẵn.

```powershell
$env:ST25_ILLUSTRATION_AUDIT='1'
node tests/redesign-browser-audit.cjs
Remove-Item Env:ST25_ILLUSTRATION_AUDIT
```

Audit kiểm tra ba loài ở 1440, 1024, 768, 390 và 320px, thay đổi dữ liệu ảnh khi chỉnh riêng thân/mắt, fallback SVG, hủy/khôi phục iframe và việc loại bỏ điều khiển 3D/trưởng thành. Kết quả tại `skin-motion-results.json`; ảnh tại `skin-motion-*.png`. Dùng API giả lập, không thực hiện giao dịch thật.

Triển khai `src/`, `assets/`, `server.js` và `vercel.json` như hướng dẫn kiến trúc. URL trang vẫn là `/skin.html`.
