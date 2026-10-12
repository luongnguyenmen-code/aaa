# Rà soát độ ổn định ST25

Đã đồng bộ `origin/main` tại commit `d2d3d8a9538419bf807d8c2acd68b57110cbf47c` trước khi sửa. Các thay đổi hiện ở máy local; chưa push hoặc triển khai. Không thực hiện giao dịch, lệnh quản trị hay mua hàng trên API thật trong quá trình kiểm tra.

## Các lỗi đã sửa

- Gộp các GET trùng giữa bộ đọc JSON/Response, cache ngắn cho player/Gara và chạy song song các đọc độc lập. POST không tự gửi lại; chặn nhấp đôi và đặt thời hạn cả phần tải body. Tôn trọng hủy request và `Retry-After`.
- Không coi Gara mất kết nối là Gara rỗng. Hợp nhất dữ liệu local/cloud; giữ giá trị sức khỏe bằng 0 và Prime Elder. Khôi phục thất bại giữ nguyên khủng long; chặn khôi phục/bán thú đang niêm yết hoặc giao dịch. Phần thưởng khủng long từ hòm được lưu vào Gara.
- Kiểm tra xác nhận API trước khi báo thành công hoặc thay đổi quyền sở hữu. Kiểm tra giá từ danh mục server, không tin giá client. Hoàn lại trạng thái nhiệm vụ khi nhận thưởng thất bại. Chuyển Lúa giữa hai người chỉ gửi phần chênh lệch cần thiết; hoàn tiền khi bên nhận từ chối chắc chắn.
- Ghi biên nhận trước tác động lên API. Khi mất kết nối sau gửi, giữ biên nhận cần đối soát và chặn giao dịch tiếp theo của các bên liên quan; không tự hoàn/gửi lại khi chưa biết kết quả. Dùng chung khóa giao dịch và tác vụ hết hạn; giải phóng khóa nếu request bị hủy trước khi vào handler.
- Ghi JSON bằng file tạm + fsync + rename. Lỗi ghi hoặc JSON hỏng trả lỗi thay vì báo lưu thành công hay ghi đè bằng dữ liệu mặc định. Thêm PostgreSQL tùy chọn cho trạng thái portal, cấu hình và biên nhận dùng chung giữa nhiều instance.
- Không tạo bí mật phiên mặc định công khai. Chờ xác nhận đăng xuất; bảo vệ giao diện khỏi storage bị chặn, dữ liệu phiên cũ và HTML/URL không an toàn từ ticket/HUD. Lỗi đọc nhiệm vụ không giả thành chưa liên kết Steam.
- Lệnh Kick/Ban bị từ chối không đánh dấu đã xử lý. Cấp role đã lưu vẫn thành công khi việc đọc Gara sau đó bị gián đoạn. Cứu kẹt gửi yêu cầu và kiểm tra phản hồi thay cho thông báo thành công giả.

## Bằng chứng kiểm tra

- `npm test`: 12 bộ kiểm tra, gồm cú pháp, route, asset, xác thực, API, backend/frontend và bộ hồi quy độ ổn định mới. Kiểm tra tĩnh bao phủ 26 HTML, 143 script, 20 JSON, 74 route API và tài nguyên Skin. Đây không phải bằng chứng mọi dòng code đều không còn lỗi.
- [Browser audit](.build-cache/reliability-browser/redesign-audit-results.json): 16 trang desktop và 5 lượt trang mobile; không phát hiện runtime error, ảnh hỏng hoặc tràn ngang trong fixture.
- [Skin audit](.build-cache/reliability-skin/islepilot-skin-results.json): 1440, 1024, 768, 390 và 320px; kiểm tra canvas, màu, preset, pattern, phiên, khóa glitch, phí và dừng render khi ẩn. Dùng WebGL phần mềm; không phải phép đo FPS trên điện thoại thật.
- [API đọc thật](.build-cache/live-read-audit.json): một lần đọc mỗi endpoint `/server`, `/sell-rules`, `/shop/skins`, `/cases`; khoảng 1,83 giây cho server và 0,23–0,24 giây cho ba endpoint còn lại. Đây là mẫu đơn, không phải benchmark tải hay cam kết độ trễ.
- Bộ hồi quy dùng tài khoản/dữ liệu tạm và API giả lập. Bao phủ lỗi ghi đĩa, JSON hỏng, mất phản hồi giao dịch, hoàn tiền, khóa hai bên qua khởi động lại, mua bị từ chối, giao phần thưởng, cứu kẹt/Kick bị từ chối, cấp role khi Gara offline và request bị hủy.
- PostgreSQL đã được kiểm tra bằng mock pool, hai instance độc lập và luồng HTTP/model/journal tích hợp; chưa kiểm tra với database thật.

## Cấu hình trước khi triển khai

Người dùng đã xác nhận website chạy trên Vercel. Vì vậy PostgreSQL là yêu cầu cho bản triển khai này, không phải tùy chọn. `PLINKO_SETUP.md` ghi có Neon project `ST25 VIETNAM GAME` và biến `PLINKO_DATABASE_URL` trên Vercel Production; thông tin đó chưa được kiểm chứng lại trong phiên này. Có thể dùng cùng database nếu kết nối trực tiếp và có quyền tạo bảng, với biến `PORTAL_DATABASE_URL` riêng; bảng portal không trùng bảng Plinko. Phiên này không có trình duyệt/tài khoản Vercel kết nối để cấu hình hoặc xác minh database production.

Hiện chưa có `PORTAL_DATABASE_URL` trong môi trường được kiểm tra. Node một tiến trình có ổ đĩa bền vững vẫn dùng JSON. Có thể đặt `ST25_DATA_DIR` đến thư mục ổ đĩa bền vững đã chứa bản sao `server-config.json` và `portal-data.json`; biên nhận được tạo ở đó. Không đặt thư mục rỗng rồi mong dữ liệu cũ tự chuyển sang.

Vercel hoặc nhiều instance cần `PORTAL_DATABASE_URL` PostgreSQL **kết nối trực tiếp**, không dùng transaction pooler/PgBouncer/port 6543. Adapter tạo bảng `st25_portal_state`, khởi tạo bản JSON hiện có chỉ khi hàng chưa tồn tại, rồi dùng DB làm nguồn dữ liệu. Khóa advisory trên cùng phiên bảo vệ luồng ghi; ghi đang bận trả 429 để người dùng thử lại sau, các lượt đọc vẫn chạy song song. Không đặt dữ liệu tiền/tài sản trên `/tmp` hoặc filesystem Vercel để coi là đã lưu bền vững. Nếu nơi lưu không ghi được, hệ thống trả lỗi và có thể chặn thao tác; phải cấu hình nơi lưu trước triển khai.

Biên nhận `review`/`inflight` cần BQT kiểm tra số dư, tài sản và kết quả lệnh thực tế theo ID thao tác. Chỉ đánh dấu `resolved` sau khi đã đối soát và sửa trạng thái cần thiết. Với JSON, thao tác quản trị trực tiếp trên `mutation-journal.json` cần tránh lúc server đang ghi; với DB, dùng quy trình cập nhật payload tương ứng khi không có giao dịch đang chạy. Chưa có màn hình quản trị đối soát tự động.

## Giới hạn còn cần xác minh

Không thể tạo transaction nguyên tử bao trùm nhiều API ví/tài sản của IslePilot. Biên nhận giúp phát hiện và chặn lặp; không thay thế sự hỗ trợ idempotency/transaction từ nhà cung cấp.

Luồng market/trade cloud hiện dùng endpoint bán để lấy thú ra rồi chuyển Lúa theo thỏa thuận. Luồng mua Skin nhận Skin rồi trừ Lúa riêng. Chưa xác minh endpoint bán/mua của nhà cung cấp có tự cộng/trừ Lúa hay không; có nguy cơ tính tiền hai lần hoặc thưởng ngoài thỏa thuận nếu hợp đồng API khác giả định hiện tại. Không tự đổi quy tắc kinh tế khi chưa có tài liệu/fixture chính thức. Trước mở giao dịch thật cần kiểm chứng hai hợp đồng này bằng môi trường thử của nhà cung cấp.

Payload `commands` với `action: unstuck` cần xác nhận được IslePilot hỗ trợ; fixture chỉ xác minh website gửi đúng payload đang triển khai và xử lý từ chối trung thực. Combat log hiện có phần tạo sự kiện mô phỏng từ tên người chơi, chưa phải telemetry chiến đấu đã được API xác thực.

Kiểm tra không dùng mua/bán, Kick/Ban, cứu kẹt hoặc đổi Skin thật. Chưa đo tải nhiều người đồng thời, mạng di động hay database production. Các giới hạn này ngăn việc cam kết đã loại bỏ mọi lỗi hoặc mọi khả năng giật lag/mất dữ liệu.
