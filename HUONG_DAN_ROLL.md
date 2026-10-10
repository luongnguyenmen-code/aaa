# Roll ST25 — Lên Voi hoặc Đi Ngủ

Trang: `/roll.html`, mục **Kinh Tế & Chợ → Lên Voi hoặc Đi Ngủ** trên máy tính và điện thoại.

Tỷ lệ đã được chủ web chọn: 15 ô, đỏ 7/15, đen 7/15, xanh 1/15. Đỏ/đen trả tổng x2, xanh trả tổng x14, đã bao gồm tiền gửi. Vòng chung 23 giây: nhận gửi 15 giây đầu, quay và dừng trong 8 giây tiếp theo. Mỗi tài khoản một mức gửi mỗi vòng; có thể đổi màu trong thời gian nhận gửi. Không dùng tỷ lệ 30% thắng của các trò sòng bạc cũ. Bản này không có jackpot Triple Green của trang tham khảo.

## Tạo PostgreSQL và bật gửi Lúa

1. Đăng ký/đăng nhập [Neon](https://console.neon.tech/), tạo project PostgreSQL dành cho ST25. Chọn khu vực gần nơi Vercel chạy ứng dụng. Xem [hướng dẫn kết nối của Neon](https://neon.com/docs/connect/connect-from-any-app).
2. Trong project Neon chọn **Connect**, chọn database/user. **Tắt Connection pooling** rồi sao chép connection string PostgreSQL trực tiếp, giữ các tham số SSL mà Neon cung cấp. Roll dùng khóa PostgreSQL theo kết nối nên không nhận URL có `-pooler`.
3. Vào project `aaa` trên Vercel → **Settings → Environment Variables**, thêm cho **Production**:

   | Biến | Giá trị |
   |---|---|
   | `ROLL_DATABASE_URL` | Connection string PostgreSQL trực tiếp vừa sao chép |
   | `ROLL_ENABLED` | `true` |

4. Giữ `ISLEPILOT_API_TOKEN` hiện có trên Vercel. Token cần quyền đọc người chơi/ví và thay đổi currency. Không đưa token hoặc connection string vào GitHub, HTML hay tin nhắn công khai.
5. Vercel → **Deployments → bản Production mới nhất → Redeploy**. Biến môi trường chỉ có hiệu lực với deployment mới. [Hướng dẫn Vercel](https://vercel.com/docs/environment-variables).
6. Mở `/api/roll/state`: phải có `ready: true`, `demo: false`. Lần kết nối đầu tiên tự tạo các bảng `st25_roll_*`; database user cần quyền tạo bảng. Nếu trang vẫn báo lỗi, kiểm tra log Vercel và URL trực tiếp/SSL trước khi gửi.
7. Đăng nhập Steam trên web. Đối chiếu ví game với số Lúa trên trang. Kiểm tra gửi tối thiểu 1 Lúa và kết quả trong một vòng trước khi thông báo rộng rãi.

Chưa có database hoặc `ROLL_ENABLED` chưa bật: trang vẫn có vòng quay và nút thử miễn phí; API từ chối gửi Lúa. Chế độ thử không trừ/cộng ví, không lưu gửi và không dùng để chứng minh ngẫu nhiên của chế độ thật.

## Giao dịch và đối soát

Máy chủ xác định kết quả; frontend chỉ hiển thị. PostgreSQL lưu seed/cam kết trước gửi, một gửi duy nhất mỗi tài khoản/vòng, mã request chống gửi trùng, khóa người chơi giữa các instance Vercel và trạng thái giao dịch trước khi gọi IslePilot. Tiền gửi/trả thưởng đi qua `/players/{steamId}/currency` với reason `st25_roll_debit_{betId}` hoặc `st25_roll_payout_{betId}`.

Tiền thắng được xử lý khi người chơi mở trang, hoặc mở lại trang sau khi vòng kết thúc, qua POST `/api/roll/settle`. Không phụ thuộc bộ hẹn giờ nền trong một Vercel function. Kết quả/lịch sử được cập nhật khoảng hai giây một lần khi tab hiển thị.

IslePilot hiện chưa được xác minh có khóa idempotency cho currency. Nếu timeout hoặc mất kết nối sau khi gửi lệnh, Roll giữ `review`, `debit_pending` hoặc `credit_pending` để đối soát, không tự gửi lại lệnh cộng/trừ. Quản trị viên tra ledger trong Neon và nhật ký currency IslePilot theo bet ID/reason, xác nhận tiền đã thực sự áp dụng rồi xử lý thủ công. Không đổi trạng thái hoặc cộng bù khi chưa đối chiếu. `ROLL_ENABLED=false` dừng gửi mới; vẫn cho thanh toán các gửi đã xác nhận.

SQL xem các gửi cần đối soát:

```sql
SELECT id, steam_id, round_id, amount, payout, status, updated_at
FROM st25_roll_bets
WHERE status IN ('review', 'debit_pending', 'credit_pending')
ORDER BY updated_at DESC;
```

## Kiểm tra

`npm test` bao gồm kiểm tra tỷ lệ/tiền trả, cam kết seed, SQL PostgreSQL giả lập, gửi trùng, đổi màu, đóng gửi, người chơi khác, trừ Lúa thất bại, không trả thưởng hai lần và trạng thái không rõ kết quả. Các kiểm tra này không dùng API hoặc Lúa thật. Kết nối PostgreSQL thật và quyền API được kiểm tra sau khi cấu hình hosting.

## Chuyển động vòng quay

Số vòng hiển thị bắt đầu từ 1 khi bản mới nhận yêu cầu trạng thái đầu tiên. Mốc đánh số được lưu trong PostgreSQL và dùng chung cho người chơi, giữ nguyên khi khởi động lại máy chủ. Mã vòng nội bộ và giao dịch cũ vẫn được giữ; các vòng trước mốc dùng mã cũ để đối soát. Chế độ thử không có database bắt đầu từ 1 theo phiên máy chủ.

Dải 15 ô dùng requestAnimationFrame: 4 giây đầu quay đều 9 ô/giây, 4 giây sau giảm tốc liên tục về 0 và dừng đúng tâm ô kết quả của máy chủ. Quỹ đạo giảm tốc được tính theo ô đích; vận tốc tại điểm nối vẫn là 9 ô/giây. Khi trở lại tab, trang đọc lại trạng thái; chế độ giảm chuyển động hiển thị trực tiếp ô kết quả.

`node tests/roll-motion-regression.cjs` kiểm tra đủ 15 ô và kết quả đến muộn. `node tests/roll-browser.cjs` kiểm tra Chrome ở 1440, 768, 390 và 320 px bằng dữ liệu giả lập, chặn các giao dịch thật.
