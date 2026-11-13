# G3 – Plan sửa code và prompt (Mai Anh – Mua hàng)

Ngày: 2026-11-08. Nguồn: đối chiếu BPMN G3 (Lucid) với code offsite và plan "Project Planning & Prep 2".
Mỗi prompt dán nguyên vào một phiên Claude Code mở ở thư mục `offsite`. Làm theo thứ tự P1 → P2 → P3 → P4 vì P2 và P3 đụng cùng file Order.

## Việc cần chốt trước khi làm P2

1. Sau khi thêm `shipped`, Pantry và Ritual DNA vẫn nghe `delivered` (khách bấm "Đã nhận hàng") hay chuyển sang `shipped`? Mặc định trong prompt: giữ `delivered`.
2. `total_sold_quantity` / `sold_quantity` đang cộng khi sang `delivered`. Mặc định trong prompt: giữ `delivered`.
3. Đơn `shipped` mà khách không bấm "Đã nhận hàng": có tự chuyển `delivered` sau X ngày không? Mặc định trong prompt: không, đơn ở lại `shipped` và vẫn được hoàn trả, điểm vẫn posted sau 3 ngày.
4. (P1) Khách không xử lý món hết hàng thì đơn đứng ở `processing` bao lâu? Hiện chưa có hạn. Đề xuất: nhắc sau 24h và 48h, tự huỷ sau 72h kèm hoàn tiền (cần chốt, chưa nằm trong prompt).
5. (P1) Đơn QR: hoàn thủ công qua `pending_payout` (đang dùng) hay đổi sang điểm thưởng / mã giảm giá cho phần chênh nhỏ? Mặc định trong prompt: hoàn thủ công.

## P1. Khách tự xử lý hết hàng sau khi đặt (thay cho "liên hệ shop")

Hiện tại: admin đánh dấu dòng hết hàng, khách chỉ nhận thông báo "Contact us to swap...", admin áp lựa chọn. Cần: khách chọn đổi món / bỏ món ngay trên chi tiết đơn, theo UI đã duyệt (9 ảnh trong thư mục `p1/out`).

Quy tắc hoàn tiền theo phương thức thanh toán (`order.payment.method`):

| Phương thức | Đã trả tiền? | Khi đổi sang món rẻ hơn / bỏ món | Cần thêm trong UI |
|---|---|---|---|
| `cod` | Chưa (payment_status pending) | Không hoàn. Chỉ giảm tổng tiền phải trả khi nhận hàng. Bỏ dòng cuối thì huỷ đơn, không có tiền để hoàn | Footer ghi "pay on delivery", không có chữ Refund |
| `card`, `bank_transfer` | Rồi | Hoàn về đúng thẻ đã dùng (`payment.card_info`), `refund_status = completed` ngay | Ghi "Refund to Visa ···· 4242" |
| `qr` | Rồi, nhưng không biết tài khoản nguồn | Không hoàn tự động được. Khách chọn thẻ đã lưu hoặc nhập thẻ/tài khoản nhận hoàn (giống `refund_payment` của form hoàn trả đơn COD/QR). Khoản hoàn ở `refund_status = pending_payout` cho đến khi nhân viên chuyển tiền và bấm "Đã hoàn" | Bước "Where should we send your refund?", nhãn PENDING sau khi đổi |

Trường hợp đổi sang món cùng giá thì không có tiền hoàn, cả ba phương thức đều bỏ qua bước nhận hoàn.

Plan:
- Backend: tách logic `listOutOfStockReplacements` và `resolveOutOfStockLine` (đang nằm trong `admin.controller.js`) ra service dùng chung, thêm 2 endpoint cho khách, thêm `refund_status` và `refund_destination` vào `removed_items`, thêm endpoint admin đánh dấu đã hoàn.
- Frontend: banner "Resolve now" dưới banner trạng thái (giữ nguyên banner processing), modal chọn món, modal xác nhận, bước nhận hoàn cho QR, nút "Chat with a human".
- Giữ nguyên đường admin để xử lý thay khách.

Prompt:

```
Trong repo offsite, khách hiện chưa tự chọn được món thay thế khi đơn bị đánh dấu hết hàng (admin.controller.js: markItemsOutOfStock, listOutOfStockReplacements, resolveOutOfStockLine; thông báo ORDER_ITEM_OUT_OF_STOCK đang bảo khách liên hệ shop). Hãy làm:

1. Backend
 - Tạo backend/src/services/order-out-of-stock.service.js, chuyển logic liệt kê món thay thế (cùng giá hoặc rẻ hơn) và áp dụng lựa chọn (swap/remove, repriceOrder, ghi removed_items, hoàn kho đúng, huỷ cả đơn nếu bỏ dòng cuối) từ admin.controller.js sang service. admin.controller.js gọi lại service, hành vi admin không đổi.
 - Hoàn tiền theo order.payment.method:
   * cod: không hoàn, chỉ giảm pricing.total. Bỏ dòng cuối thì huỷ đơn, không hoàn.
   * card và bank_transfer (đơn đã paid): hoàn về đúng thẻ trong payment.card_info, refunded += phần chênh, refund_status = 'completed'.
   * qr (đơn đã paid): bắt buộc body có refund_destination { method, brand, last4, cardholder_name } (hoặc saved_card_id của user), lưu vào removed_items[].refund_destination, refund_status = 'pending_payout'. Thiếu refund_destination khi có tiền hoàn thì trả 400.
   * Đổi sang món cùng giá: không có tiền hoàn nên không cần refund_destination.
   Thêm refund_status (completed | pending_payout) và refund_destination vào schema removed_items trong Order.js. payment_status vẫn giữ paid, chỉ ghi refunded_amount.
 - Thêm vào orders.routes.js: GET /api/orders/:id/out-of-stock/replacements và POST /api/orders/:id/out-of-stock/resolve, dùng optionalAuthMiddleware và authorizeOrderAccess như các endpoint đơn khác. Chỉ cho phép khi order_status = processing và dòng có out_of_stock = true, sai trạng thái trả 409 INVALID_ORDER_STATE.
 - Thêm endpoint admin POST /api/admin/orders/:id/out-of-stock/refunds/:index/mark-paid (role admin_cc, qlsp) chuyển pending_payout → completed, ghi internal note, gửi thông báo cho khách ("Your $x refund was sent to ..."). Hiện khoản pending_payout trong chi tiết đơn admin và gợi ý "Needs attention" nếu muốn.
 - changed_by là user_id hoặc 'guest'. Ghi internal note và gửi ORDER_ITEMS_UPDATED như bản admin.
 - Sửa nội dung thông báo ORDER_ITEM_OUT_OF_STOCK: bảo khách vào chi tiết đơn để chọn đổi hoặc bỏ món, và deep link vào đơn.
 - Gọi nhiều lần không được hoàn tiền hai lần (idempotent: dòng đã resolve thì trả 400).
2. Frontend (features/purchase/pages/order-detail), làm đúng theo ảnh mockup:
 - Khi đơn processing có dòng out_of_stock: giữ nguyên banner trạng thái processing, thêm banner vàng "1 item in your order is out of stock" kèm nút "Resolve now" ngay dưới banner trạng thái. Dòng hết hàng có tag OUT OF STOCK, nút "Choose replacement" và link "Remove item".
 - Modal "Resolve out-of-stock item": món cần thay, danh sách món thay thế (nhãn "Same price" / "Refund $x"; với COD nhãn "New total -$x"), lựa chọn "Remove this item", hàng "Not sure what to pick?" có nút "Chat with a human" mở sẵn chat với nhân viên (dùng cơ chế mở chat đã có của widget, gửi kèm order_id và tên món nếu widget cho phép), footer hiện tổng mới.
 - Đơn QR có tiền hoàn: sau "Continue" hiện modal "Where should we send your refund?" (thẻ đã lưu hoặc nhập brand, last4, cardholder name).
 - Modal xác nhận: so sánh món cũ và mới, tổng cũ/mới, dòng hoàn tiền theo phương thức (COD: "Pay on delivery"), cảnh báo không hoàn tác.
 - Bỏ dòng cuối cùng: modal "Remove your only item?" nói rõ sẽ huỷ cả đơn và hoàn toàn bộ (COD thì không có hoàn).
 - Sau khi xong: banner xanh "Your order was updated", khối "Order changes" trong Items ordered, Payment Summary có dòng hoàn (QR hiện "Refund pending" kèm tag PENDING), toast. Cập nhật đơn, tổng tiền, refunded_amount.
 - Mobile: bottom sheet thay cho modal.
 - Xử lý 409/400: tải lại đơn và đóng modal. Làm tương tự cho guest (dùng session_id như các action khác).
3. Admin order-detail vẫn xử lý thay khách được (khi khách nhờ qua chat), thêm nút "Mark refund sent" cho khoản pending_payout.
4. Cập nhật backend/scripts/e2e-purchase-flows.js với các case: khách tự đổi món (card), COD đổi món rẻ hơn (không hoàn, total giảm), QR đổi món rẻ hơn (thiếu refund_destination → 400, có thì pending_payout, admin mark-paid → completed), khách bỏ món cuối cùng (đơn bị huỷ + hoàn đúng theo phương thức).
Không đổi gì ngoài phạm vi này. Chạy test/script e2e và báo kết quả.
```

## P2. Trạng thái `shipped`

Quy tắc đã chốt (đã ghi vào plan):
- `shipping` → `shipped` sau 24 giờ (bên vận chuyển đã giao, khách chưa xác nhận).
- Khi `shipped`: đơn ở tab Shipping của /account?tab=orders; COD thành `paid`; điểm thưởng đếm 3 ngày để `posted`; khách yêu cầu hoàn trả trong 3 ngày kể từ lúc `shipped`.
- Khách bấm "Đã nhận hàng" → `delivered`: được review, vẫn hoàn trả được nếu còn trong 3 ngày (tính từ lúc `shipped`).

Plan theo file:
- `models/Order.js`: enum thêm `shipped`; trường `shipped_at`; hook stamp `shipped_at`; COD `paid` khi vào `shipped` (hiện là khi `delivered`); `wasStockSubtracted` thêm `shipped`; backfill.
- Job mới `services/order-auto-ship.service.js` (khởi động trong `src/index.js`, mẫu giống `pending-order-expiry.service.js`).
- `controllers/orders.controller.js`: `receiveOrder` chỉ nhận từ `shipped`; `requestRefund` cho `shipped` và `delivered`, cửa sổ tính từ `shipped_at`; `getOrderStatus` trả `shipped_at`.
- `services/points.service.js`: post điểm purchase và referral_order theo `shipped_at`.
- `controllers/admin.controller.js`, `admin-dashboard.controller.js`: lọc/hiển thị `shipped`.
- Frontend: account tab Shipping, order-detail, refund-window, admin order model/listing, notification model.

Prompt:

```
Thêm trạng thái đơn hàng mới `shipped` vào repo offsite. Ngữ cảnh: shipped nghĩa là bên vận chuyển đã giao nhưng khách chưa bấm "Đã nhận hàng".

Quy tắc:
- Đơn ở `shipping` quá 24 giờ thì hệ thống tự chuyển sang `shipped` (đơn quay lại shipping từ delivery_failed thì tính 24 giờ từ lần `shipping` gần nhất trong status_history).
- Khi shipped: đơn COD đổi payment_status sang paid (hiện đang làm lúc delivered); điểm thưởng purchase bắt đầu đếm 3 ngày để posted; khách được yêu cầu hoàn trả trong 3 ngày kể từ shipped_at; đơn hiện trong tab Shipping của /account?tab=orders.
- Khi khách bấm "Đã nhận hàng": shipped -> delivered (set delivered_at). Từ delivered khách được review, và vẫn yêu cầu hoàn trả được nếu còn trong 3 ngày tính từ shipped_at.
- Admin không tự chuyển sang shipped (ADMIN_STATUS_TRANSITIONS giữ nguyên, shipping chỉ -> delivery_failed).
- Giữ nguyên: Pantry và Ritual DNA vẫn chạy khi delivered; total_sold_quantity vẫn cộng khi delivered.

Việc cần làm:
1. backend/src/models/Order.js: thêm 'shipped' vào enum order_status; thêm shipped_at (Date, default null); trong pre-save stamp shipped_at khi vào shipped; COD set payment_status = 'paid' khi order_status là shipped hoặc delivered; thêm 'shipped' vào wasStockSubtracted; chắc rằng huỷ/hoàn vẫn hoạt động từ shipped.
2. Tạo backend/src/services/order-auto-ship.service.js giống pending-order-expiry.service.js (claim nguyên tử, lease, chạy mỗi 5 phút, biến môi trường SHIPPED_AFTER_MINUTES để demo, mặc định 24*60). Đổi order_status sang shipped với _changedBy = 'system', ghi status_history, emit socket emitOrderUpdated, gửi notification ORDER_SHIPPED (thêm type mới vào models/Notification.js và notification.model.ts, nội dung: đơn đã giao, hãy xác nhận đã nhận hoặc yêu cầu hoàn trả trong 3 ngày). Khởi động job trong src/index.js.
3. orders.controller.js: receiveOrder chỉ chấp nhận order_status = 'shipped'; requestRefund chấp nhận 'shipped' hoặc 'delivered', cửa sổ 3 ngày tính từ shipped_at (fallback status_history 'shipped', rồi delivered_at cho đơn cũ); getOrderStatus trả shipped_at.
4. services/points.service.js: postDuePoints cho 'purchase' và 'referral_order' cho phép order_status 'shipped', 'delivered' hoặc 'refund_rejected', đếm HOLD_DAYS từ shipped_at (fallback delivered_at). Cập nhật comment về cửa sổ hoàn trả.
5. reviews.controller.js: giữ điều kiện chỉ delivered, sửa message cho rõ ("Hãy xác nhận đã nhận hàng trước khi đánh giá").
6. admin.controller.js: mapStatusFilter, urgent/needs-attention, buildOrderDetail trả shipped_at, filter 'shipped'; admin-dashboard.controller.js: thêm ô Shipped trong thanh trạng thái, các phép tính theo delivered_at xem lại có nên dùng shipped_at không (doanh số 7 ngày dùng shipped_at).
7. Script backend/scripts/backfill-shipped-at.js: đơn delivered/refund/pending_refund/refund_rejected chưa có shipped_at thì set = delivered_at (hoặc lần 'shipping' gần nhất + 24 giờ).
8. Frontend:
 - features/account/pages/account.component.ts: tab Shipping đếm và lọc gồm 'shipping', 'delivery_failed', 'shipped' (xem dòng ~480 và ~2023); nhãn và class cho shipped; điều hướng chi tiết.
 - features/purchase/pages/order-detail: thêm cấu hình banner/steps cho shipped ("Đã giao, vui lòng xác nhận đã nhận hàng"); nút "Đã nhận hàng" chỉ hiện khi shipped (không hiện khi shipping); nút yêu cầu hoàn trả hiện khi shipped hoặc delivered nếu còn trong hạn; nút review chỉ khi delivered.
 - features/purchase/models/refund-window.model.ts: tính hạn từ shipped_at, hiển thị khi shipped hoặc delivered.
 - order-return, order-tracking, order-confirmed: cho phép shipped.
 - admin/orders: admin-order.model.ts thêm 'shipped', listing filter, detail hiển thị shipped_at.
9. ai-chat.controller.js: chỗ trả lời trạng thái đơn xử lý thêm shipped.
10. Cập nhật e2e-purchase-flows.js: case shipping -> shipped (SHIPPED_AFTER_MINUTES nhỏ) -> yêu cầu hoàn trả từ shipped -> delivered -> review; COD paid khi shipped.
Chạy script e2e, báo kết quả và liệt kê file đã đổi. Không đổi logic Pantry/Ritual DNA.
```

## P3. Huỷ thay cho bỏ đơn (đồng bộ BPMN)

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

## P4. Ritual Box sau trạng thái `suspended`

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

## Việc cần sửa trong BPMN (Lucid) và plan

Plan (Project Planning & Prep 2):
- Đã sửa: quy tắc `shipped` ở tab Mai Anh (BPMN mục 3 và 4, Order history, Sửa Order) và tab Hệ thống điểm thưởng (2 dòng điểm).
- Chưa sửa, cần sửa tay hoặc nhờ làm tiếp:
  1. Tab Mai Anh, BPMN mục 3 mục con "Hết hàng sau khi đặt": đã sửa (khách tự chọn, nút Chat with a human, quy tắc hoàn theo COD / card / bank_transfer / QR, pending_payout, admin bấm "Đã hoàn"), cùng với Orders (refund_status, refund_destination) và dòng Orders ở màn hình Admin. Còn lại: thêm vào bảng Màn hình khối banner "Resolve now" và các modal trong chi tiết đơn khách.
  2. Tab Ritual Box, quy ước "Kích hoạt lại": bỏ "QLSP và Admin CC cũng kích hoạt lại được", thay bằng admin chỉ gửi đề xuất resume. Thêm quy ước tự huỷ sau N ngày suspended (nếu chốt).
  3. Dashboard Admin 3.1: thanh trạng thái 6 ô cần thêm Shipped; 3.4 "Số đơn đã giao" xem lại theo shipped_at.
  4. Data collection (Orders): đã thêm shipped và shipped_at ở phần Sửa Order của tab Mai Anh, nhưng bảng trường Orders ở mục B3 chưa kiểm tra.
  5. Pantry (Feature 7), Ritual DNA (DNA-3, DNA-5) vẫn ghi `delivered`, giữ nguyên nếu chốt như mặc định.

BPMN (Lucid):
- Trang "Đặt hàng & thanh toán": Huỷ đơn đã tách, Lỗi 409/400 đã quay lại Checkout (đã xong theo bạn). Còn thiếu: "Đổi phương thức thanh toán" trên nhánh Trả lại; nhánh "đã trả tiền nhưng không tạo được box" (subscription_start_failed, Start Ritual Box); gắn đơn guest vào tài khoản qua OTP.
- Trang "Xử lý, giao hàng & hoàn tiền": thêm `shipped` (tự chuyển sau 24h, COD paid, điểm bắt đầu đếm, tab Shipping), nút "Đã nhận hàng" ở shipped → delivered → review; "Yêu cầu hoàn" chuyển sang gắn với shipped (và delivered nếu còn hạn); nhánh "Chọn đổi món" chuyển thành khách chọn trên web (lane Khách hàng ↔ Hệ thống), admin chỉ xử lý thay; thêm gateway theo phương thức thanh toán: COD (chỉ giảm tổng), card / bank_transfer (hoàn về thẻ), QR (khách nhập nơi nhận hoàn → pending_payout → admin bấm "Đã hoàn"); thêm nhánh "Chat with a human".
- Trang "Duy trì Ritual Box": Suspended không còn là end event, nối sang Cập nhật thẻ + Kích hoạt lại (thành công → Active; thất bại → quay lại Suspended); Huỷ bởi khách; Huỷ bởi Admin CC (Repeated payment failure); tự huỷ sau N ngày (nếu chốt); bỏ annotation admin kích hoạt lại.
- Trang BPMN số 6 (khách tạm dừng, đổi tần suất, huỷ; admin huỷ): chưa vẽ.
- Trang đầu "BPMN – Ritual Box" (bản flow hiện tại): xoá hoặc ghi chú là bản cũ.
