# Support chat previews

Các ảnh `chat-closed-*`, `chat-waiting-*` và `chat-open-*` là ảnh render ứng dụng với **dữ liệu giả lập**, không phải dữ liệu khách hàng thật.

Đối chiếu frame Support chat trong Figma: danh sách 340px, hội thoại 526px, panel khách 260px ở preview desktop 1600×1100. Mobile 390px chuyển về một cột; đã kiểm tra không tràn ngang. Email/đơn hàng chỉ hiện khi API cho phép đọc hồ sơ khách. Quy tắc mở lại giữ 3 giờ đã chốt, thay vì 24 giờ trên mockup.

Các thẻ đơn hàng trong lịch sử dùng metadata thực của API; không thêm ảnh hay voucher mẫu vào tin nhắn thật. Header/sidebar chung vẫn theo module admin hiện tại.

Ảnh `chat-transfer-modal-desktop`, `chat-close-modal-desktop/mobile` và `chat-customer-share-order` kiểm tra modal Transfer/Close và chỗ khách chọn đơn để gửi. Tất cả dùng dữ liệu mẫu. Transfer lấy online từ kết nối socket và số chat Open thực; người offline hoặc CSKH đủ 5 chat không được chọn. Close lưu outcome cùng summary nội bộ, hỗ trợ tắt tin kết thúc gửi cho khách.

Ảnh `chat-mine-fidelity-desktop/mobile` và `chat-customer-order-cards` đối chiếu thẻ đơn của khách/CSKH, Quick actions có icon, hàng trả lời nhanh và composer theo frame Mine. Các thẻ đơn dùng metadata có sẵn; ảnh cũ thiếu thumbnail dùng placeholder của Figma. Orders hiện mở chi tiết đơn theo quyền hiện tại, không giả lập việc gửi yêu cầu hoàn tiền. Give personal voucher mở form complaint đã chọn sẵn khách; Report customer dùng luồng báo cáo tài khoản có sẵn.
