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

## Share order, Transfer and Close (08/11)

- Customer: sign in, open the chat drawer, send a request through Talk to a person. In a live Waiting/Mine conversation, use **Share order** above the input, choose one of the five recent account orders. The card appears in the customer history and the agent thread. Guests can provide an order code in text; account order selection requires sign-in.
- Agent: select an open owned chat, use **Share order** below the reply box, choose a recent customer order and click **Send order**. Backend ownership checks apply to both senders; order cards contain status, items and totals, without delivery contact details.
- Transfer: open **Transfer**, select an online colleague below capacity, enter the required internal note, then confirm. Offline/full choices are disabled and backend checks presence/capacity again. The customer receives a neutral transfer notice; internal notes stay private. Use a second signed-in support browser tab to test online presence.
- Close: **Close** opens a modal. Choose Resolved / Forwarded / No response / Spam, optionally write a summary, choose whether to send the closing message, then confirm. Cancel leaves the conversation open. The summary is saved privately in Customer Notes in the closure transaction; no summary text is sent to the customer. Forwarded records the chosen outcome; it does not submit or approve a refund.
- Closed remains read-only. The previously agreed reopen window is **3 hours during support hours**, with capacity fallback to Waiting; it is not the 24-hour wording in the mockup.

## Visual alignment and order-card regression (08/11)

CSKH Orders read-only update: both `/admin/orders` and `/admin/orders/:id` now allow CSKH. API list, stats and detail read the current staff assignments from DB and include customers in the staff member's open/closed claimed chats (canonical or legacy agent IDs). Unrelated customers remain forbidden. Status, stock, refunds and internal-note writes remain restricted to Admin CC/QLSP. Verified the reported order `OFS-2026-00117`: detail/list 200, present in scoped list, empty note-write request 403 without changing data. Reload the app and reopen the order from Chat or the Orders menu; the existing `/admin/403` page does not redirect itself.

- Mine now uses a compact AI summary, 300px message bubbles, 14px order-card text, thumbnails, item counts and currency formatting. Composer includes draft-only quick replies and icon buttons below the input. Quick actions use the existing Orders, personal-voucher and account-report workflows.
- The Orders action is deliberately labelled **Open order / refund details**: CSKH cannot write order notes or approve refunds under the current Orders permissions. It does not pretend to submit a refund request. Personal-voucher links open the existing complaint form with the current customer preselected; server validation remains unchanged.
- Fixed customer drawer templates: order cards now render for **user and agent** messages as well as AI, including history reloads. Previously they were stored but only the AI message branch rendered them.
- Newly shared orders include the first item image and total quantity. Old snapshots without images use the local Figma placeholder; no fabricated product images or voucher cards are added.
- Join/system notices no longer overwrite the customer issue in queue previews. Historical previews are not rewritten.
