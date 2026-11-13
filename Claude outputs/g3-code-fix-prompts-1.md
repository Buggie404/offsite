# G3 – Plan sửa code và prompt (Mai Anh – Mua hàng)

Ngày: 2026-11-08 (cập nhật tối 08/11). Nguồn: đối chiếu BPMN G3 (Lucid) với code offsite và plan "Project Planning & Prep 2".
Mỗi prompt dán nguyên vào một phiên Claude Code mở ở thư mục `offsite`. Làm theo thứ tự P1 → P2 → P3 → P4.

Thay đổi so với bản trước:
- Bỏ trạng thái `shipped` (P2 cũ). Plan và BPMN đã quay về `delivered`; code chưa đổi gì nên không cần sửa.
- Bỏ màn khách tự đổi món trên chi tiết đơn (P1 cũ, 9 màn Figma). Kho được giữ từ lúc đặt nên đơn một lần / hỗn hợp không còn hết hàng sau khi đặt. Hết hàng chỉ còn ở kỳ gia hạn Ritual Box, xử lý ở tab Ritual Box.
- Thêm P4: đơn `delivery_failed` cần khách xác nhận lại (hoặc huỷ) trước khi giao lại. Ý tưởng "xác nhận" của màn đổi món cũ được chuyển sang đây.

## Đã chốt cho delivery_failed

- Nhắc khách một lần ở 12 giờ, tự huỷ sau 24 giờ không phản hồi.
- Giao lại tối đa 2 lần (lần giao đầu + 2 lần giao lại); thất bại lần thứ 3 thì chỉ huỷ và hoàn tiền.
- Chat with a human mở sẵn chat và điền sẵn mã đơn.

## Việc cần chốt

1. Hàng đã giữ cho đơn processing mà kho gặp sự cố (hư, thất lạc): hiện admin chỉ huỷ được đơn sau delivery_failed. Có cho admin huỷ đơn processing (bắt buộc lý do, hoàn toàn bộ) không? Prompt P1 chưa làm phần này.
2. Mốc giữ kho cho Ritual Box: plan đang ghi 3 ngày trước next_charge_at (cùng lúc gửi SUBSCRIPTION_UPCOMING). Muốn sớm hơn (ví dụ 5 ngày) thì đổi trong plan và prompt.
3. Hoàn tiền đơn QR bị huỷ sau delivery_failed: plan đang ghi khách nhập nơi nhận hoàn, QLSP hoặc Admin CC chuyển tay rồi bấm "Đã hoàn" (`pending_payout`). Phương án khác: hoàn bằng điểm hoặc voucher.

## P1. Giữ kho từ lúc đặt và ràng buộc kho cho Ritual Box

Hiện tại trong code:
- Checkout đã giữ kho khi tạo đơn (`stock_reserved`), đơn pending quá hạn thì nhả (pending-order-expiry.service.js), huỷ và hoàn trả được duyệt thì `inventory.service.releaseItems`.
- Admin vẫn có luồng đánh dấu dòng hết hàng cho đơn processing (admin.controller.js: markItemsOutOfStock, listOutOfStockReplacements, resolveOutOfStockLine, cancelOutOfStockOrder; subscription.service.js: skipCycleForCanceledOrder). Luồng này không còn đúng với plan.
- Ritual Box chỉ kiểm tra và giữ kho đúng lúc charge (subscription.service.js: chargeSubscription → reserveItems), nên QLSP không có thời gian chuẩn bị hàng.

Prompt:

```
Trong repo offsite, plan "Project Planning & Prep 2" vừa đổi quy tắc kho của nhóm 3 (Mua hàng). Hãy sửa code cho khớp:

1. Đơn một lần và đơn hỗn hợp (kiểm tra, chỉ sửa khi thiếu)
 - Kho giữ ngay khi tạo đơn ở checkout (stock_reserved = true), trừ thẳng vào variants.stock.
 - Nhả kho đúng một lần khi: đơn pending hết hạn 24 giờ hoặc khách bỏ đơn; đơn bị huỷ bất kể ai huỷ (khách, admin sau delivery_failed); yêu cầu hoàn trả được duyệt (theo số lượng hoàn). Viết test cho cả 3 trường hợp, kể cả gọi lặp không nhả 2 lần.
2. Bỏ luồng hết hàng sau khi đặt cho đơn một lần / hỗn hợp
 - Gỡ route và nút admin "mark out of stock" / chọn món thay / resolve (admin.controller.js: markItemsOutOfStock, listOutOfStockReplacements, resolveOutOfStockLine, cancelOutOfStockOrder và route tương ứng; UI admin order-detail). Bỏ điều kiện "còn dòng out_of_stock thì không cho chuyển shipping".
 - Gỡ skipCycleForCanceledOrder và thông báo ORDER_ITEM_OUT_OF_STOCK / ORDER_ITEMS_UPDATED nếu không còn chỗ gọi. Giữ các field cũ trong schema (items[].out_of_stock, removed_items, refunded_amount) để đọc dữ liệu cũ, nhưng không ghi mới.
3. Ritual Box: giữ kho trước kỳ charge
 - Trong subscription-charge.service.js, ở bước gửi SUBSCRIPTION_UPCOMING (3 ngày trước next_charge_at), giữ kho cho kỳ tới bằng inventory.service.reserveItems với variant và quantity của box. Lưu vào Subscription: reserved_for (= next_charge_at của kỳ đã giữ) và reserved_items [{ product_id, variant_id, quantity }]. Idempotent: đã giữ cho kỳ đó thì không giữ lại.
 - Giữ thất bại vì thiếu hàng: gửi SUBSCRIPTION_OUT_OF_STOCK ngay (kèm gợi ý thay thế cùng giá hoặc rẻ hơn như hiện có), đưa box vào việc cần làm "Ritual Box sắp charge mà hết hàng" của dashboard admin. Mỗi lượt job tiếp theo thử giữ lại; QLSP nhập đủ hàng thì tự giữ được.
 - chargeSubscription: nếu box đã giữ kho cho kỳ này thì tạo đơn từ phần đã giữ, không trừ kho lần nữa và không kiểm tra stock lại. Chưa giữ được thì không charge, áp quy tắc hiện có: chờ tối đa 3 ngày kể từ next_charge_at, khách chọn món thay (use_replacement) thì giữ kho món thay rồi charge, quá hạn thì bỏ qua kỳ và không charge.
 - Nhả phần kho đã giữ khi: khách skip kỳ đó, pause, cancel; box chuyển suspended; kỳ bị bỏ qua vì hết hàng; khách đổi món / đổi số lượng (nhả cũ, giữ mới). Charge lỗi nhưng còn lượt thử lại thì giữ nguyên.
 - Chế độ demo SUB_TIME_UNIT=minute: mốc 3 ngày đổi theo đơn vị thời gian như các mốc khác.
4. Cập nhật backend/scripts/e2e-purchase-flows.js và test subscription: giữ kho trước kỳ, charge dùng phần đã giữ, thiếu hàng rồi QLSP nhập hàng, khách chọn món thay, quá 3 ngày bỏ qua kỳ và nhả kho, skip/pause/cancel nhả kho.
Không đổi gì ngoài phạm vi này. Chạy test và báo kết quả.
```

## P2. Huỷ thay cho bỏ đơn (đồng bộ BPMN)

Hiện tại: `DELETE /api/orders/:id` xoá hẳn đơn pending (frontend `discardOrder` ở checkout và payment-qr). BPMN đã đổi thành "Huỷ đơn", nên đơn phải còn trong lịch sử với trạng thái canceled.

Prompt:

```
BPMN đã bỏ khái niệm "bỏ đơn", chỉ còn "huỷ đơn". Trong repo offsite hiện checkout.component.ts (~dòng 1142) và payment-qr.component.ts (~dòng 120) gọi checkoutService.discardOrder -> DELETE /api/orders/:id (orders.controller.js deleteOrder, xoá hẳn đơn pending). Hãy:
1. Đổi hai chỗ frontend sang checkoutService.cancelOrder (PUT /api/orders/:id/cancel) để đơn giữ lại với trạng thái canceled, hoàn kho, hoàn voucher, thu hồi điểm như luồng huỷ hiện có. Xoá discardOrder trong checkout.service.ts nếu không còn nơi dùng.
2. Backend: bỏ route DELETE /api/orders/:id và deleteOrder (hoặc để lại nhưng trả 410) sau khi chắc chắn không còn nơi gọi; cập nhật e2e-purchase-flows.js nếu có dùng.
3. Kiểm tra mọi nơi khác coi đơn pending bị xoá là bình thường (order history, thông báo ORDER_PLACED khi đã tạo) vẫn đúng khi đơn chuyển sang canceled.
4. Khi tạo đơn lỗi 409 OUT_OF_STOCK hoặc 400, checkout hiển thị lỗi theo dòng và ở lại Checkout để khách sửa giỏ (không điều hướng đi nơi khác). Kiểm tra và sửa nếu chưa đúng.
Chạy e2e và báo kết quả.
```

## P3. Ritual Box sau trạng thái `suspended`

Đề xuất luồng (đã khớp phần lớn với code, chỉ cần bổ sung):
- `suspended` và `payment_failed` cùng một nhánh: khách cập nhật thẻ rồi "Kích hoạt lại" → trừ tiền ngay một lần.
  - Thành công → `active`, `next_charge_at` tính từ lúc trừ thành công, reset số lần lỗi.
  - Thất bại (kể cả hết hàng) → giữ nguyên trạng thái cũ, giữ thẻ mới, báo lý do, không mở lại chu kỳ retry.
- Khách huỷ → `cancelled`.
- Admin CC huỷ với lý do "Repeated payment failure" (chỉ khi `suspended`) → `cancelled_by_admin`.
- Mới (cần chốt): `suspended` quá N ngày (đề xuất 30) thì hệ thống tự huỷ với lý do "Repeated payment failure" (`cancelled_by_admin`), báo khách; nhắc khách sau 7 ngày suspended.
- Admin kích hoạt lại: code hiện không có, và plan đang mâu thuẫn (nguyên tắc admin chỉ làm thao tác không phát sinh tiền, trong khi kích hoạt lại trừ thẻ khách). Đề xuất sửa plan: admin chỉ **gửi đề xuất resume**, khách tự bấm kích hoạt lại; không thêm action `reactivate` cho admin.

Prompt (chỉ làm khi đã chốt tự huỷ sau N ngày):

```
Ritual Box: làm rõ các trạng thái sau `suspended`. File: backend/src/services/subscription.service.js (applyAction: payment_method, reactivate, cancel), subscription-charge.service.js, admin-subscription.service.js, models/Subscription.js.
1. Kiểm tra payment_failed và suspended cùng đi qua payment_method / reactivate và chỉ cho phép payment_method, reactivate, cancel; reactivate thành công thì status = active, failed_attempts = 0, next_retry_at = null, last_failure_reason = null, next_charge_at tính từ lúc trừ thành công. Reactivate thất bại thì giữ nguyên trạng thái cũ, lưu thẻ mới nếu có, trả lỗi rõ lý do (hết hàng, thẻ hết hạn, từ chối), và không làm failed_attempts đếm lại chu kỳ retry 24h/48h/72h.
2. Thêm suspended_at vào Subscription (set khi chuyển sang suspended). Trong subscription-charge.service.js thêm một bước trong runPass: subscription suspended quá SUSPENDED_AUTO_CANCEL_DAYS (env, mặc định 30; dùng addCycleDays/addUnits để demo SUB_TIME_UNIT=minute) thì tự đổi sang cancelled_by_admin, cancel_reason 'Repeated payment failure', ghi lịch sử, gửi SUBSCRIPTION_CANCELLED. Gửi SUBSCRIPTION_SUSPENDED nhắc lại một lần sau 7 ngày suspended (đánh dấu bằng trường suspended_reminded_at).
3. Không thêm action reactivate cho admin. Admin CC dùng 'propose' (type resume) như hiện tại; kiểm tra khi khách chấp nhận đề xuất resume đối với box suspended/payment_failed thì đi qua đúng luồng reactivate (có trừ tiền) và báo lỗi nếu thẻ chưa hợp lệ.
4. Admin UI (admin/subscriptions): với box suspended hiển thị suspended_at, số ngày còn lại trước khi tự huỷ, và lý do lần lỗi cuối.
5. Thêm case vào backend/scripts/e2e-subscription-charge.js: suspended -> reactivate thất bại -> vẫn suspended; suspended -> đổi thẻ + reactivate thành công -> active; suspended quá hạn -> cancelled_by_admin.
Chạy script và báo kết quả.
```

## P4. delivery_failed: khách xác nhận giao lại hoặc huỷ

Bối cảnh: dự án không xử lý phần vận chuyển của bên thứ ba, nên `delivery_failed` chỉ là trạng thái admin ghi nhận theo báo cáo của bên vận chuyển. Hiện admin chọn "Giao lại" (về shipping) hoặc "Huỷ" mà khách không có tiếng nói. Đổi lại: nhóm lý do liên quan đến khách (không liên lạc được, sai hoặc thiếu địa chỉ, khách từ chối nhận) thì khách phải xác nhận lại trước khi giao lại; nhóm sự cố vận chuyển (hư hỏng, thất lạc) thì admin quyết định luôn. Kho vẫn giữ trong lúc chờ. BPMN: trang "BPMN G3 - Giao thất bại & xác nhận giao lại".

Quy tắc hoàn tiền khi huỷ (khách, hệ thống hoặc admin): COD không hoàn (chưa thu); card và bank_transfer hoàn toàn bộ về đúng thẻ (`refund_status = completed`); QR cần khách nhập nơi nhận hoàn, `refund_status = pending_payout` cho đến khi QLSP hoặc Admin CC bấm "Đã hoàn".

Prompt:

```
Trong repo offsite, làm tính năng "khách xác nhận giao lại" cho đơn delivery_failed. Bắt đầu bằng grep delivery_failed ở backend (admin.controller.js, orders.controller.js, models/Order.js, notification) và frontend (order-detail của purchase, orders-listing và order-detail của admin) để biết luồng hiện có, rồi mới sửa.

1. Model Order (backend/src/models/Order.js): thêm
 - delivery_failed_reason_code: enum customer_unreachable | wrong_address | refused | carrier_issue
 - delivery_failed_reason: String (ghi chú của admin; giữ trường lý do cũ nếu đã có, chỉ map sang đây)
 - delivery_attempts: Number (số lần giao thất bại, mặc định 0, +1 mỗi lần admin chuyển delivery_failed). Giao lại tối đa MAX_REDELIVERY_ATTEMPTS = 2 lần (env), nghĩa là lần giao đầu + 2 lần giao lại = 3 lần; thất bại lần thứ 3 (delivery_attempts = 3) thì không còn giao lại
 - redelivery: { status: awaiting_customer | confirmed | expired, requested_at, expires_at, reminder_sent_at, confirmed_at, contact_phone, shipping_address (cùng shape với địa chỉ giao của đơn), note }
 - refund_status: pending_payout | completed (null nếu không có gì để hoàn) và refund_destination: { bank_name, account_number, account_holder } (chỉ dùng cho đơn QR)
 Đơn cũ không có các trường này vẫn phải đọc được.
2. Admin chuyển delivery_failed (endpoint hiện có): bắt buộc gửi reason_code và ghi chú. Tăng delivery_attempts. Nếu reason_code khác carrier_issue và delivery_attempts <= MAX_REDELIVERY_ATTEMPTS thì set redelivery.status = awaiting_customer, requested_at = now, expires_at = now + REDELIVERY_CONFIRM_HOURS (env, mặc định 24), gửi thông báo ORDER_DELIVERY_FAILED cho khách. Nếu carrier_issue thì không tạo redelivery. Nếu delivery_attempts > MAX_REDELIVERY_ATTEMPTS thì không tạo redelivery và thông báo cho khách biết đơn sẽ được huỷ và hoàn tiền (admin chỉ còn nút Huỷ đơn). Kho vẫn giữ (stock_reserved không đổi).
3. Endpoint khách (đúng chủ đơn, chỉ khi order_status = delivery_failed và redelivery.status = awaiting_customer, sai thì 409):
 - POST /api/orders/:id/redelivery/confirm { contact_phone, shipping_address, note }: validate SĐT và địa chỉ như checkout, lưu vào redelivery, status = confirmed, confirmed_at = now, ghi status_history, thông báo cho admin (việc cần làm). Không đổi địa chỉ gốc của đơn, chỉ chuyển sang shipping khi admin bấm "Giao lại". Gọi lặp không ghi lặp lịch sử.
 - POST /api/orders/:id/redelivery/cancel { refund_destination? }: huỷ đơn theo luồng huỷ hiện có (nhả kho đúng một lần, hoàn voucher, thu hồi điểm). Đơn QR đã thanh toán thì bắt buộc refund_destination, set refund_status = pending_payout; card và bank_transfer đã thanh toán thì hoàn về đúng thẻ, refund_status = completed; COD không đụng đến tiền.
4. Admin: nút "Giao lại" chỉ bật khi delivery_attempts <= MAX_REDELIVERY_ATTEMPTS và (redelivery.status = confirmed hoặc reason_code = carrier_issue); sai thì 409. Giao lại thì order_status = shipping, báo khách, redelivery giữ lại để tra cứu. Admin vẫn huỷ được bất kỳ lúc nào (bắt buộc lý do), áp cùng quy tắc hoàn tiền. Thêm POST /api/admin/orders/:id/refunds/mark-paid cho đơn QR pending_payout (QLSP và Admin CC), set refund_status = completed, gửi thông báo cho khách.
5. Job định kỳ (cùng chỗ với pending-order-expiry.service.js): nhắc khách một lần ở REDELIVERY_REMINDER_HOURS = 12 giờ kể từ requested_at (thông báo ORDER_REDELIVERY_REMINDER, đặt reminder_sent_at để không gửi lặp), quá expires_at (24 giờ) thì redelivery.status = expired, tự huỷ đơn như bước huỷ ở trên với lý do "Khách không phản hồi sau delivery_failed" và gửi ORDER_REDELIVERY_EXPIRED. Đơn QR đã thanh toán tự huỷ: refund_status = pending_payout, khách nhận thông báo kèm link nhập refund_destination (cho phép nhập sau khi đơn đã huỷ). Demo: dùng đơn vị thời gian như các mốc khác nếu có (ví dụ SUB_TIME_UNIT).
6. Frontend khách (purchase/order-detail): giữ nguyên banner trạng thái của delivery_failed, thêm khối "Xác nhận giao lại" dưới banner, tái sử dụng khung .ritual-start-box đổi màu cho lỗi giao hàng: hiện lý do giao thất bại, form SĐT, địa chỉ (chọn từ sổ địa chỉ hoặc nhập mới), ghi chú cho shipper; nút "Giao lại" (primary), "Huỷ đơn" (secondary, mở modal xác nhận; đơn QR đã thanh toán thì modal có form nơi nhận hoàn), và nút "Chat with a human" mở sẵn chat với admin và điền sẵn mã đơn: tìm component chat hiện có (grep chat ở frontend và ChatConversations ở backend), thêm tham số order_id/order_code để mở chat với mã đơn đã hiện trong tin nhắn đầu hoặc ô soạn tin, và lưu context_order_id trong ChatConversation để CSKH thấy đơn mà không phải hỏi lại. Hiện đếm ngược thời gian còn lại để xác nhận (ví dụ "Reply within 23h") và dòng "Redelivery 1 of 2"; đơn đã dùng hết lượt giao lại thì ẩn form, chỉ báo đơn sẽ được huỷ. Đã confirmed thì hiện trạng thái "Đã xác nhận, chờ giao lại" thay cho form. Đơn QR pending_payout hiện dòng "Đang chờ hoàn tiền" và cho nhập refund_destination nếu chưa có. Mobile: modal thành bottom sheet như các modal hiện có.
7. Frontend admin: nút chuyển delivery_failed có select nhóm lý do + ô ghi chú; trong chi tiết đơn hiện redelivery (status, SĐT, địa chỉ, ghi chú, còn bao lâu); orders-listing thêm filter "Chờ khách xác nhận" và "Khách đã xác nhận, chờ giao lại"; hiện hàng việc cần làm "Đơn QR đã huỷ chờ hoàn tiền" với nút "Đã hoàn". Dashboard Sales-Ops mục 3.2: đơn giao thất bại hiện khi khách đã xác nhận giao lại hoặc đã được nhắc lúc 12 giờ mà chưa phản hồi.
8. Test: cập nhật backend/scripts/e2e-purchase-flows.js và thêm case: (a) lý do wrong_address -> awaiting_customer -> khách confirm -> admin giao lại -> shipping; (b) admin bấm giao lại khi chưa confirm -> 409; (c) carrier_issue -> admin giao lại thẳng; (d) khách huỷ: COD không hoàn, card hoàn về thẻ, QR pending_payout rồi admin mark-paid; (e) quá 24 giờ tự huỷ và nhả kho đúng một lần; (f) gọi confirm hoặc cancel hai lần không ghi lặp; (g) giao thất bại lần thứ 3 thì không tạo redelivery, admin giao lại bị 409, chỉ huỷ được; (h) nhắc 12 giờ chỉ gửi một lần dù job chạy nhiều lần; (i) mở chat từ đơn thì ChatConversation có context_order_id đúng mã đơn.
Không đổi gì ngoài phạm vi này. Chạy test và báo kết quả.
```

## Việc đã sửa trong plan và BPMN (08/11 tối)

Cập nhật sau (22:30): delivery_failed.
- Plan: BPMN mục 3 (giao thất bại) viết lại: nhóm lý do, khách xác nhận lại trước khi giao lại, huỷ (khách, quá hạn, admin), hoàn tiền theo phương thức; màn User order detail (khối "Xác nhận giao lại"), màn Admin Orders, Dashboard 3.2, Sửa Order (reason_code, redelivery, refund_status, refund_destination), Notifications, mục Giữ kho (đơn delivery_failed vẫn giữ kho). Đã kiểm tra: plan không còn `shipped`.
- BPMN (Lucid): thêm trang "BPMN G3 - Giao thất bại & xác nhận giao lại" (sau trang Xử lý, giao hàng & hoàn tiền); trang Xử lý đổi nhãn delivery_failed, Huỷ đơn và bước nhả kho cho khớp.

Plan (Project Planning & Prep 2):
- Hoàn nguyên `shipped` về `delivered`: điểm thưởng (posted sau 3 ngày kể từ delivered, chỉ hoàn trong 3 ngày kể từ delivered), dòng Order history, Sửa Order, BPMN mục 4 (chỉ yêu cầu hoàn khi delivered, trong 3 ngày).
- BPMN mục 3: mục con "Shipped" đổi thành "Giữ kho"; mục con "Hết hàng sau khi đặt" đổi thành "Hết hàng" (chỉ còn ở kỳ gia hạn Ritual Box); đầu mục 3 ghi "giữ và nhả kho".
- BPMN mục 5: thêm giữ kho trước kỳ charge và nhánh hết hàng.
- Ritual Box, quy ước "Hết hàng khi đến chu kỳ": giữ kho 3 ngày trước next_charge_at, chưa giữ được thì chưa charge, các trường hợp nhả kho.
- Màn hình Admin Orders: bỏ "xử lý hết hàng"; Admin Subscription: thêm theo dõi box sắp charge mà chưa giữ được kho.
- Data collection: Orders bỏ out_of_stock / removed_items / refunded_amount cho đơn mới, stock_reserved ghi rõ lúc nhả; bỏ ORDER_ITEM_OUT_OF_STOCK và ORDER_ITEMS_UPDATED; Subscriptions thêm reserved_for, reserved_items.

BPMN (Lucid):
- "BPMN G3 - Đặt hàng & thanh toán": bước tạo đơn ghi rõ giữ kho; huỷ đơn ghi "nhả kho"; thêm chú thích các trường hợp nhả kho.
- "BPMN G3 - Xử lý, giao hàng & hoàn tiền": bỏ nhánh Đủ hàng? / đánh dấu hết hàng / đổi hoặc bỏ món / huỷ cả đơn; Processing nối thẳng sang Chuyển shipping; thêm chú thích kho đã giữ; dời phần dưới lên cho gọn.
- "BPMN G3 - Duy trì Ritual Box": trước kỳ 3 ngày nhắc khách và giữ kho; "Giữ kho?" thay cho "Còn hàng?"; thiếu hàng thì báo khách và QLSP, chưa trừ tiền; "Có hàng / có món thay?"; quá 3 ngày bỏ qua kỳ và nhả kho; suspended và các thao tác skip / pause / huỷ của khách đều nhả kho; chú thích đơn gia hạn luôn đủ hàng.

Còn lại chưa làm (từ danh sách trước):
- Ritual Box sau Suspended (P3) và BPMN số 6 (khách tạm dừng, đổi tần suất, huỷ; admin huỷ) vẫn chưa vẽ.
- Trang "Đặt hàng & thanh toán" chưa có nhánh "Đổi phương thức thanh toán", "đã trả nhưng không tạo được box" và gắn đơn guest vào tài khoản.
