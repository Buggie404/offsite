# Kiểm tra sửa đổi chat

Chạy từ thư mục gốc bằng PowerShell: `npm.cmd start`. Nếu backend đang chạy sẵn thì khởi động lại để nhận sửa đổi ID/socket. Mở `/admin/chat` bằng tài khoản CSKH; mở cửa sổ ẩn danh hoặc trình duyệt khác cho khách để giữ hai phiên đăng nhập riêng.

Hướng dẫn này ghi lại vòng sửa chat ban đầu. Xem [N4 review và kiểm thử](n4-review-and-testing.md) để có quy tắc 3 giờ, giờ hỗ trợ 08:00–22:00, giới hạn 5 chat, transfer và kết quả migration mới nhất. Dependency `html-to-image` đã được khôi phục; backend health check đã trả về bình thường.

Chuẩn bị: một chat chờ chưa claim, một chat của mình, một chat của nhân viên khác mà tài khoản có quyền xem, và một khách có cả chat cũ đã đóng lẫn chat mới. Có thể nhờ tài khoản khách yêu cầu gặp nhân viên trong AI chat để tạo hàng chờ.

| Thao tác | Kết quả mong đợi |
| --- | --- |
| Vào `/admin/chat` | Mặc định Waiting. Có Waiting / Mine / Closed / All và số khách trong mỗi tab. |
| Chuyển Mine | Chỉ có chat `open` do mình nhận; nhận diện cả `user_id` và `_id` cũ. |
| Chuyển Closed | Thấy lịch sử đã đóng kể cả khi cùng khách đang có chat mới; mở lịch sử rồi chờ hơn 3 giây vẫn giữ đúng cuộc đang chọn. |
| Chuyển All | Xem tất cả chat trong phạm vi được API cho phép, bao gồm chat được phân công khách nhưng nhân viên khác đang xử lý. |
| Gõ tên hoặc ID khách | Danh sách lọc theo từ khóa, không phân biệt hoa/thường; xóa từ khóa thì danh sách trở lại. Chưa hỗ trợ tìm email. |
| Chọn AI handover / Direct | Lọc kết hợp với tab và từ khóa. AI được nhận diện từ liên kết phiên AI/Dify hoặc thông tin bàn giao; bản ghi cũ không có các thông tin này được xếp Direct. |
| Đổi Latest activity / Oldest activity | Đảo thứ tự theo thời gian tin nhắn/hoạt động cuối. Đây không phải thời gian chờ bàn giao. |
| Mở chat chưa claim | Chỉ xem, không có ô gửi tin; có AI summary nếu API cung cấp và nút Claim & reply. |
| Nhấn Claim & reply | Chuyển sang Mine, hiện ô soạn tin; gửi tin và kiểm tra khách nhận được qua socket. |
| Mở chat người khác đang xử lý | Hiện thông báo chỉ xem; không có ô gửi, nút claim hoặc close cho CSKH. |
| Đóng chat của mình, xác nhận | Chuyển sang Closed, chỉ đọc. Trong 3 giờ và giờ hỗ trợ, khách trả lời có thể mở lại; nút Talk to chatbot cho phép chọn AI rõ ràng. |
| Soạn nháp rồi chọn khách khác hoặc đổi tab | Nháp được xóa, tránh gửi nhầm nội dung cho khách khác. |
| Từ dashboard bấm chat đang xử lý | Link cũ `?status=open` vẫn mở Mine. `?status=waiting` vẫn mở Waiting. Link có `?conversation=...` mở đúng chat và tab tương ứng. |
| Có đủ tin nhắn để cuộn; kéo lên đọc rồi đợi ít nhất 6 giây hoặc để phía kia gửi tin | Màn CSKH và drawer AI/chat khách giữ vị trí đọc. Khi đang ở gần cuối, tin mới vẫn tự cuộn xuống. Chọn cuộc khác sẽ mở ở cuối. |
| CSKH có khách trong `assigned_chat_customer_ids`, khách không nằm ở hàng chờ | Hội thoại của khách vẫn xuất hiện trong All, theo phân quyền API. |
| Kiểm tra đơn hàng bằng tài khoản khách | Socket vẫn nhận thông báo/cập nhật đơn của chính mình sau khi khôi phục định danh `_id` dùng chung. |

Danh sách API hiện giới hạn 100 hội thoại gần nhất; tìm kiếm, số đếm và lọc trên các bản ghi được tải về. Mỗi tab gộp theo khách; nội dung hội thoại vẫn ghép lịch sử của khách như luồng cũ. Khi chọn một chat Closed, ô gửi vẫn bị khóa dù lịch sử có chứa tin ở phiên khác.

Vòng N4 tiếp theo đã thêm transfer và cửa sổ mở lại **3 giờ** theo bảng yêu cầu. Không dùng quy tắc 24 giờ trên Figma và không đổi tên trạng thái lưu trong database. Hoàn tiền/voucher tiếp tục theo module hiện có.

## Kiểm tra tự động

Trong `frontend`:

```powershell
npx.cmd ng test --watch=false --include=src/app/admin/chat/pages/chat/*.spec.ts --include=src/app/shared/components/ai-chat-drawer/ai-chat-scroll.spec.ts --include=src/app/core/services/chat.service.spec.ts
npx.cmd ng build
```

Trong `backend`:

```powershell
node --test test/chat-access.test.js test/ai-chat-handover.test.js
```

## Migration ID nhân viên cũ

Trong `backend`, dùng môi trường kết nối được MongoDB:

```powershell
npm.cmd run migrate:chat-agent-ids
```

Script thay Mongo `_id` của nhân viên bằng `User.user_id` trong `ChatConversations.agent_id` và `AiChatSessions.assigned_admin_id`; chạy lại được. Claim mới lưu ID ứng dụng. Migration đã chạy thành công sau khi dùng kết nối ngoài sandbox: 0 hội thoại và 0 phân công phiên AI cần đổi.
