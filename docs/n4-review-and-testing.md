# Rà soát N4-01 → N4-06

Ngày rà: 08/11/2026. Giữ phân quyền và dữ liệu của các nhóm liên quan; Figma là tham chiếu giao diện. Không tự gán phần trăm hoàn thành cho bảng dự án.

Đã xác nhận: **52 test backend liên quan, 20 test frontend liên quan pass**; kiểm tra cú pháp JavaScript và production/development build pass. Production bundle đầu khoảng **931 KB**, dưới ngưỡng lỗi 1 MB. `/api/health` trả về backend đang chạy. Các test nghiệp vụ dùng mock/thời gian cố định; chưa thay thế cho test thủ công nhiều tài khoản hay gọi Groq thật.

## Kết quả theo thứ tự

| Mục | Đã xử lý trong code | Ràng buộc giữ lại |
| --- | --- | --- |
| N4-01 | Account hiện badge DNA nếu có quiz/hồ sơ thực, bấm mở My Ritual DNA. Public Profile dùng tên archetype đúng phiên bản, bỏ nhãn “Zen purist” cố định. | Không có hồ sơ thì ẩn badge; không công khai radar hay câu trả lời quiz. Tier tiếp tục dùng hệ thống membership hiện tại. |
| N4-02 | Feed tải từng trang 9 bài, nối trang không trùng, lỗi trang nào thử lại trang đó. API luôn phân trang, tối đa 100 bài/request dù gửi `all=true`; thêm tie-break theo `_id`. Following giao với bộ lọc suspended, không ghi đè bộ lọc. | Resolver Mongo ID → `User.user_id` đã có ở Follow service; giữ lại. My Profile vẫn mở Public Profile. |
| N4-03 | Giữ xử lý report bài/comment, hidden banner, sửa bài và sản phẩm đã có; chạy test hồi quy báo cáo/trùng báo cáo/quyền cộng đồng. | Không đổi luồng moderation và điểm của nhóm khác. |
| N4-04 | Create Post tối đa 5 thẻ tổng, 3 thẻ AI. Lưu `ai_product_ids`, phục hồi nguồn khi sửa. Hiện “Suggested by AI”. Lượt gợi ý được giữ ở server: 1 lần đầu + 2 lần lại, kể cả kết quả rỗng; kiểm tra chủ draft và hạn 1 giờ. Nếu luật không đạt 0.6 thì thử LLM, chỉ nhận ID trong catalog còn hàng và confidence ≥0.6. | Luật chắc chắn không gọi LLM. Cache catalog 5 phút. Thiếu cấu hình hoặc LLM lỗi thì dùng kết quả luật/manual. Product picker của Recipe được cập nhật hợp đồng trả về, giữ giới hạn 3 sản phẩm của Recipe. |
| N4-05 | Claim/transfer chuẩn hóa ID; transaction khóa bản ghi nhân viên trước khi đếm, không nhận chat thứ 6 của CSKH. Transfer cần ghi chú nội bộ và người nhận hợp lệ. Cảnh báo 5/15 phút phân biệt đang chờ CSKH hay chờ khách. Job mỗi phút đóng chat không hoạt động 3 giờ. Khách trả lời trong 3 giờ sau khi CSKH đóng có thể trở lại người cũ; người cũ hết chỗ/không còn hoạt động thì về Waiting. | Giờ hỗ trợ **08:00–22:00 mỗi ngày (UTC+7)** theo xác nhận. Back to chatbot là lựa chọn rõ ràng, không tự mở lại sau đó. Ngoài cửa sổ 3 giờ không mở lại chat cũ; yêu cầu gặp nhân viên tiếp theo tạo chat Waiting mới, còn luồng AI vẫn dùng chính sách phiên của N5. Không chuyển Figma 24 giờ vào code. |
| N4-06 | Mở `/admin/service-customers` và chi tiết cho CSKH/Admin CC, tái sử dụng Customers. Có Orders, Internal notes, Vouchers cá nhân và Violations. API list/get/add-note kiểm tra phạm vi. | **CSKH chỉ xem khách trong `assigned_chat_customer_ids`**, đúng phạm vi Orders N2/N3. Claim chat không tự cấp quyền xem hồ sơ/đơn. Voucher tạo/sửa dùng module N6 có sẵn; không thêm quyền khóa tài khoản hay sửa điểm/tier. |

Ghi chú transfer không được broadcast ra socket phòng khách hoặc phòng nhân viên chung. Agent được phép đọc tải ghi chú qua API danh sách chat. Sau transfer, socket không còn quyền đọc bị rời phòng; gửi tin cũng kiểm tra người nhận chat, không chỉ quyền xem khách.

## Trước khi test giao diện

1. Khởi động lại backend để nạp schema, route và job mới. Ở thư mục gốc: `npm.cmd start`.
2. Dùng tài khoản CSKH có ít nhất một khách được phân công và một tài khoản khách ở cửa sổ riêng/ẩn danh.
3. Để test chuyển, cần thêm một CSKH đang active. Để test giới hạn, dùng 6 khách/6 hội thoại độc lập; UI vẫn gộp các phiên cùng khách.
4. LLM fallback dùng cấu hình Groq hiện có (`GROQ_API_KEY`, tùy chọn `GROQ_MODEL`); không cần khóa để test nhánh luật/manual. Không ghi khóa vào tài liệu hoặc ảnh chụp.

## Test thủ công theo thứ tự

| Mục | Thao tác | Kết quả mong đợi |
| --- | --- | --- |
| 01 | Account của khách chưa làm quiz; sau đó xem khách đã có DNA; xem Public Profile của hai archetype khác nhau. | Chưa làm thì không có badge DNA. Đã làm thì tên thật, bấm mở DNA; hai người không cùng bị gán Zen purist. Tier vẫn đúng. |
| 02 | Feed có hơn 9 bài: kéo xuống, đổi Coffee/Matcha/Following; xem Network `/api/posts`. | Request page=1/2/... không có all=true; bài nối thêm, đổi bộ lọc bắt đầu trang 1. Following đúng các tài khoản đã follow. Bài của suspended không có trong feed công khai. |
| 02 | Tạm ngắt mạng khi tải trang 2 rồi bật lại và Retry. | Bài trang 1 giữ nguyên; retry vẫn gọi trang 2, không nhảy trang 3. |
| 03 | Mở bài, gửi report bài/comment; thử report trùng; chủ bài mở bài đã ẩn. | Luồng có sẵn vẫn hoạt động; report trùng 409; banner bài ẩn vẫn hiện đúng quyền. |
| 04 | Tạo Post với 2 thẻ manual, nhận 3 gợi ý AI; thêm một manual nữa. | Tổng không vượt 5; thêm manual nhường chỗ từ AI. Mỗi nhóm AI có nhãn rõ ràng. Lưu rồi sửa lại vẫn đúng nguồn thẻ. |
| 04 | Suggest lần đầu rồi Suggest again hai lần; thử gọi lại request cùng `suggestion_session_id`. | Server từ chối lần thứ 4 với 429; không chỉ khóa nút ở frontend. Kết quả rỗng vẫn tính lượt. |
| 04 | Viết tên sản phẩm khớp rõ; sau đó thử mô tả mơ hồ khi có Groq. | Nhánh luật giữ threshold 0.6; fallback có `AiCallLogs.feature=community_bridge` và token/latency/status, không lưu nguyên bài viết vào log. Model không được gắn ID ngoài catalog. |
| 05 | Claim 5 chat với cùng CSKH, thử chat thứ 6; đóng một chat rồi thử lại. | Lần thứ 6 báo lỗi 409 và giữ thread; đóng bớt thì nhận được. Chuyển vào người đã đủ 5 cũng bị từ chối. |
| 05 | Mở chat của mình, Transfer, chọn CSKH khác và nhập ghi chú. | Chuyển quyền trả lời sang người nhận, giữ lịch sử. Người cũ không còn gửi được. Khách không nhận nội dung ghi chú nội bộ. |
| 05 | Có tin cuối từ khách hoặc nhân viên rồi không trả lời 5/15 phút. | Nhãn cảnh báo nói rõ đang chờ ai; có trả lời mới thì mốc tính theo lượt mới. |
| 05 | CSKH đóng chat, khách nhắn lại trong 3 giờ, trong giờ hỗ trợ. | Trở lại người cũ nếu còn sức chứa; nếu đủ 5/không active thì về Waiting. Chọn Talk to chatbot trong cửa sổ này thì giữ AI, không tự reopen. |
| 05 | Chat đã nhận không có hoạt động 3 giờ. | Job đóng và đồng bộ phiên AI, cập nhật frontend; chạy theo nhịp 1 phút, tối đa 200 chat/lượt. Giữ Waiting chưa nhận để không làm mất yêu cầu để lại lời nhắn ngoài giờ. |
| 05 | Kiểm tra 07:59, 08:00, 21:59, 22:00 bằng test clock tự động. | Mở từ 08:00, đóng từ 22:00 Việt Nam. Ngoài giờ không claim/transfer mới, AI dùng form để lại lời nhắn. |
| 06 | Menu Customers của CSKH; xem khách được phân công; mở URL khách ngoài phạm vi. | Danh sách chỉ đúng phạm vi, khách ngoài trả 403. CSKH không có nút unlock. Chat đã claim nhưng chưa phân công không tự xuất hiện ở Customers. |
| 06 | Chi tiết khách: Orders, Vouchers, Violations, Notes; Back. | Các tab hiện dữ liệu thật/empty state, không lẫn Notes vào Vouchers. Back về `/admin/service-customers`. Link voucher đi tới module voucher hiện tại. |

Test 5/15 phút và 3 giờ có unit test dùng thời gian cố định; không cần chờ đủ 3 giờ để kiểm tra các điều kiện biên. Chưa xác nhận thủ công toàn bộ các luồng nhiều tài khoản trên dữ liệu thật, cũng chưa chạy LLM thật.

## Migration và kiểm tra

Migration `backend/scripts/migrate-chat-agent-ids.js` đã chạy thành công trên môi trường MongoDB cấu hình: **0 hội thoại, 0 phân công phiên AI cần đổi**. Có thể chạy lại bằng `npm.cmd run migrate:chat-agent-ids` trong `backend`.

Các field mới không đoán nguồn AI hoặc giờ đóng của dữ liệu cũ. Bài cũ không có `ai_product_ids` được coi là manual; chat cũ không có `closed_at`/`close_reason=resolved` không tự mở lại theo cửa sổ mới.

```powershell
# Trong backend
node --test test/chat-policy.test.js test/chat-access.test.js test/ai-chat-handover.test.js test/n4-revisions.test.js test/admin-customers.test.js test/community-revisions.test.js test/community-restriction.test.js

# Trong frontend
npx.cmd ng test --watch=false --include=src/app/features/community/pages/feed/*.spec.ts --include=src/app/features/community/components/create-post-modal/*.spec.ts --include=src/app/admin/chat/pages/chat/*.spec.ts --include=src/app/shared/components/ai-chat-drawer/*.spec.ts --include=src/app/admin/customers/pages/customer-detail/service-customer.spec.ts
npx.cmd ng build
```

Drawer AI được tải khi trình duyệt rảnh (`@defer on idle`), giảm bundle ban đầu để build production qua budget 1 MB mà không nâng budget. Các cảnh báo style/component cũ ngoài phạm vi vẫn còn.
