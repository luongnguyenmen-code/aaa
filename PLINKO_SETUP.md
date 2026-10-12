# Plinko ST25

## Cập nhật setup database — 12/10/2026

- Kiểm tra tiếp: `PLINKO_DATABASE_URL` đã có trên Production; chưa xác minh kết nối/khóa DB. `ISLEPILOT_API_TOKEN` vẫn chưa có. API công khai trả `ready:false`.
- API key IslePilot đã được gửi vào chat: cần thu hồi key đó và tạo key mới, lưu trực tiếp trên Vercel; không dùng lại key đã lộ.
- Bản redeploy dashboard ngày 12/10 chạy `iad1` dù bản trước chạy `sin1`; đang triển khai lại từ cấu hình local để khôi phục Singapore. Cần kiểm tra vùng sau mỗi redeploy.

- Đã đăng nhập Vercel CLI và tạo project `st-25-vietnam-game/st25-vietnam`, triển khai trực tiếp từ máy do liên kết GitHub thất bại.
- Production alias đã xác minh: `https://st25-vietnam.vercel.app`; function `api/index` chạy ở `sin1`. `/plinko.html` và `/api/plinko/state` trả HTTP 200, Plinko `ready:false`.
- Đã lưu production `SESSION_SECRET` ngẫu nhiên, `PLINKO_ENABLED=false`, `PUBLIC_ORIGIN=https://st25-vietnam.vercel.app`. Chưa có `PLINKO_DATABASE_URL` hoặc `ISLEPILOT_API_TOKEN` trên project mới; chưa gắn domain `www.st25.io.vn`.
- Người dùng đã tạo Neon project `ST25 VIETNAM GAME` tại Singapore (ảnh xác nhận). Cần lưu chuỗi Neon trực tiếp vào biến production `PLINKO_DATABASE_URL` và kiểm tra database/khóa trước khi bật giao dịch.

- Đã cấu hình `regions: ["sin1"]` trong `vercel.json` để backend chạy ở Singapore khi triển khai cấu hình này.
- Phương án đề xuất: Neon Free, vùng Singapore, kết nối PostgreSQL trực tiếp (không endpoint `-pooler`). Chưa tạo database hoặc lưu `PLINKO_DATABASE_URL` trên hosting.
- Phiên điều khiển máy tính hiện không có trình duyệt kết nối; thao tác mở Chrome báo `Browser is not available: chrome`. Cần kết nối trình duyệt hoặc Neon/Vercel để tiếp tục setup trên tài khoản người dùng.
- `PLINKO_ENABLED` vẫn phải giữ `false` cho đến khi kiểm tra database và ví hoàn tất. Chưa triển khai thay đổi vùng lên Vercel.

## Trạng thái tiếp tục — 12/10/2026

- Đã hoàn tất mã Plinko, menu, chơi thử, tự động thả bóng, xác minh HMAC và phần tích hợp ví Lúa miễn phí. User xác nhận Lúa không mua bán hoặc quy đổi tài sản có giá trị.
- Commit mã: `39da96b` (`Add Plinko demo and guarded free-point wallet integration`). `npm test`, kiểm tra Chrome ở bốn kích thước và build Vercel đã đạt. Chưa kiểm thử giao dịch ví thật.
- Chưa có PostgreSQL hoặc `PLINKO_DATABASE_URL`; giao dịch Lúa chưa bật. Không chỉ đổi `PLINKO_ENABLED=true` khi chưa có database và chưa kiểm tra ví.
- Push lên `https://github.com/luongnguyenmen-code/aaa.git` bị GitHub từ chối HTTP 403 vì tài khoản bị đình chỉ. Chưa xác nhận bản Plinko được triển khai trên website.
- Đã mở tab Chrome đến `https://vercel.com/dashboard` để kiểm tra hosting. Chưa xác nhận đăng nhập thành công: lần đọc trạng thái cuối bị hệ thống duyệt tự động lỗi 429. Không vượt qua kiểm tra này.
- Plugin Neon, Supabase và Vercel có trong danh mục nhưng chưa được cài/kết nối tại thời điểm kiểm tra. Máy chưa phát hiện PostgreSQL CLI, Docker hoặc Vercel CLI; chưa có biến môi trường kết nối database.

Các bước khi quay lại:

1. Người dùng đăng nhập Vercel, rồi báo đã đăng nhập. Không gửi mật khẩu hoặc chuỗi kết nối bí mật vào chat.
2. Kiểm tra đúng project đang phục vụ `www.st25.io.vn`. Tạo/kết nối PostgreSQL qua tài khoản hosting hoặc nhà cung cấp đã đăng nhập; xem gói và chi phí trước khi xác nhận dịch vụ tính phí.
3. Lấy chuỗi kết nối PostgreSQL trực tiếp, không transaction pooler, lưu vào biến môi trường server `PLINKO_DATABASE_URL`. Khởi tạo bảng/index và kiểm tra kết nối, lưu dữ liệu, khóa advisory.
4. Khắc phục quyền push GitHub hoặc dùng phương thức triển khai Vercel được cấp quyền để đưa mã Plinko hiện tại lên hosting. Không chuyển website sang Sites riêng.
5. Kiểm tra quyền IslePilot và giao dịch bằng tài khoản thử được chỉ định; đối soát debit/payout và trạng thái pending trước khi bật `PLINKO_ENABLED=true` công khai.
6. Redeploy, xác minh `/plinko.html`, API, menu trên điện thoại và desktop; báo chính xác chế độ nào đã hoạt động trên website.

Người dùng yêu cầu tạm lưu các bước để làm tiếp sau. Chưa tạo database, chưa thay đổi cấu hình hosting và chưa thực hiện giao dịch Lúa thật.

Trang `/plinko.html`, menu Kinh Tế & Chợ, desktop và điện thoại.

Đây là Plinko riêng của ST25 lấy cảm hứng từ trải nghiệm thả bóng. Không sao chép thương hiệu hoặc bảng thưởng chưa xác minh của Clash.gg. Chỉ sử dụng điểm Lúa miễn phí, không mua bán, quy đổi tiền hoặc tài sản có giá trị.

## Bật ví Lúa

Hosting hiện tại dùng Node/Express trên Vercel; triển khai repository hiện tại, không tạo website Sites riêng.

1. Cài dependencies bằng `npm ci`.
2. Cấu hình `PLINKO_DATABASE_URL` là PostgreSQL **trực tiếp**, không transaction pooler. Tài khoản DB cần quyền tạo bảng/index. Không dùng bộ nhớ hay file tạm Vercel để lưu giao dịch.
3. Cấu hình quyền IslePilot đọc player và cập nhật currency; dùng biến hosting `ISLEPILOT_API_TOKEN`. Giữ credentials trên server.
4. Đặt `PLINKO_ENABLED=true` khi database và wallet đã sẵn sàng. Redeploy trên hosting hiện có.
5. Kiểm tra `/api/plinko/state`, `ready:true`, sau đó kiểm thử bằng tài khoản điểm miễn phí được chỉ định. Chưa có database hoặc chưa bật thì chỉ chế độ thử.

API: GET `/api/plinko/state`, POST `/api/plinko/prepare`, POST `/api/plinko/play`. Steam ID lấy từ phiên đăng nhập, không từ payload. Prepare trả game ID và cam kết hash; play chỉ nhận game ID, số Lúa, số hàng, mức rủi ro và client seed. Server quyết định đường đi, ô và payout.

## Xác suất

8–16 hàng, 4 mức rủi ro. Mỗi nhánh trái/phải xác suất 50%; ô k có xác suất tổ hợp nhị thức. Kết quả HMAC-SHA256 seed server riêng cho mỗi lượt; client seed là đầu vào, số hàng là cursor. Seed được tạo trước cược, cam kết SHA-256 trước giao dịch, tiết lộ sau khi settled. Đây là thuật toán ST25, không phải seedrandom của CodePen.

Bảng trả thưởng đối xứng và chuẩn hóa khoảng 91,4% trước làm tròn, được công khai qua state. Hệ số làm tròn xuống 4 chữ số; payout là `floor(amount*multiplier)` Lúa nguyên. UI hiển thị RTP bảng và RTP thực nhận cho số Lúa đang chọn. Mức cực cao 16 hàng có hệ số biên 10.000×; chỉ chọn cấu hình này nếu kinh tế điểm cho phép payout lớn. Lượt 500 Lúa có thể trả tối đa 5.000.000 Lúa. Không có jackpot hoặc cược cộng đồng giả.

## Giao dịch và đối soát

PostgreSQL lưu seed, payload, trạng thái trước khi gọi ví. Khóa advisory theo người chơi ngăn hai instance Plinko xử lý cùng lúc. Mã game chống trùng: settled replay chỉ đọc kết quả, không gọi ví. Không tự thử lại POST currency khi timeout.

`debit_pending`, `credit_pending`, `review` chặn lượt tiếp theo. Nếu ví chưa xác nhận, đối chiếu nhật ký currency theo reason `st25_plinko_debit_<id>` / `st25_plinko_payout_<id>` và bản ghi `st25_plinko_games`. Không tự cộng bù hoặc đổi trạng thái khi chưa đối chiếu. Thao tác đối soát phải do quản trị viên có dữ liệu ví thực hiện.

Khóa này chỉ bao phủ Plinko; các tính năng ví khác và thao tác trực tiếp trong game chưa dùng chung khóa DB. Chưa có bằng chứng IslePilot hỗ trợ atomic conditional debit hoặc idempotency. Cần kiểm thử permission, đơn vị/số Lúa tối đa và cạnh tranh giao dịch trên hosting trước khi bật công khai. Không bật Plinko chỉ dựa trên `ready:true`: cờ này phản ánh cấu hình, không xác nhận kết nối/permission thành công.

## Kiểm tra

`node tests/plinko-regression.cjs` dùng fake wallet/store, không giao dịch thật; `npm test` chạy kiểm tra dự án. `node tests/plinko-browser.cjs` kiểm tra Chrome ở bốn kích thước màn hình, HMAC, chế độ thử và tự động bằng ví giả lập; ảnh và kết quả lưu tại `.build-cache/plinko-browser/`. Không kết luận đã triển khai hoặc đã xác nhận wallet thật khi chỉ qua test offline.
