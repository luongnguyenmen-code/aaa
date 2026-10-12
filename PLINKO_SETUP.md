# Plinko ST25

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
