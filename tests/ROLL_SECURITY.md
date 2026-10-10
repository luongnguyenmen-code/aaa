# Rà soát Roll trước khi mở Lúa thật

## Đã sửa

- Loại bỏ khóa ký phiên dự phòng cố định. Thiếu secret hoặc secret ngắn hơn 32 ký tự: từ chối đăng nhập và mở cược thật.
- Giới hạn cược mới 500 Lúa trên máy chủ và giao diện; xanh trả tổng tối đa 7.000, đỏ/đen tối đa 1.000. Cược cũ được thanh toán theo số tiền đã xác nhận.
- Đọc số dư không dùng cache ngay trước khi nhận cược; kiểm tra lại hạn đóng sau khi đọc ví.
- Chặn cược và thanh toán thêm khi có debit_pending, credit_pending hoặc review. Không gửi lại lệnh currency có kết quả không rõ.
- Từ chối phản hồi currency có số dư âm; giữ giao dịch để đối soát.
- Kiểm tra màu là chuỗi hợp lệ và request ID đúng định dạng UUID trước SQL.

## Đã kiểm tra bằng dữ liệu giả lập

`npm test`: giả mạo phiên bằng khóa cũ, secret thiếu/yếu, giới hạn 500/501, UUID sai, cược đóng trong lúc đọc ví, request trùng, đổi màu không trừ hai lần, khóa tài khoản giữa các instance, trả thưởng một lần, chặn tài khoản có giao dịch không rõ, seed/kết quả không lộ trước đóng cược, xác suất và tiền trả x2/x14.

Các kết quả này không bảo đảm hệ thống không còn mọi lỗi; chưa có kiểm thử tiền thật hoặc PostgreSQL production.

## Điều kiện còn cần xác minh khi triển khai

- PostgreSQL trực tiếp hoạt động; SESSION_SECRET đủ mạnh và giống nhau trên mọi instance; token IslePilot có quyền đọc ví và thay đổi currency.
- IslePilot phải xử lý trừ tiền nguyên tử và không cho âm ví khi người chơi đồng thời chuyển Lúa, mua hàng hoặc thao tác trong game. Khóa PostgreSQL hiện tại bảo vệ Roll với Roll; khóa của các tính năng ví khác vẫn nằm trong bộ nhớ từng instance. Đây là giới hạn cần kiểm tra trước khi mở rộng người chơi thật.
- Chưa xác minh currency có khóa idempotency; các giao dịch không rõ kết quả cần đối soát thủ công.
- Kiểm tra /api/roll/state trả ready:true, demo:false sau deployment mới, rồi đối chiếu một giao dịch nhỏ được người quản trị chủ động thực hiện với lịch sử ví game.

Xác suất giữ nguyên: đỏ 7/15, đen 7/15, xanh 1/15. Không ép thua theo tài khoản. Giới hạn trả thưởng áp dụng mỗi cược mới, không phải giới hạn tổng thắng trong ngày.
