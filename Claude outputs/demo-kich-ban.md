# Kịch bản demo Web 2: data giả lập

Data tạo bằng `backend/scripts/seed-demo.js`. **Chạy lại trước mỗi buổi**: script xoá bộ demo cũ rồi tạo lại, mọi mốc thời gian (hạn 24h giao lại, đề xuất 3 ngày, lần thử thanh toán lại) tính từ lúc chạy.

```bash
cd /Users/judyhoang/offsite/backend && node scripts/seed-demo.js
```

```bash
cd /Users/judyhoang/offsite/backend && node scripts/seed-demo.js --clear
```

## Tài khoản

- **Tài khoản trình bày: USR00005 (Anh Hoàng Nguyễn Mai)**. Mọi case có tương tác qua lại giữa admin và user nằm ở tài khoản này. Seed chỉ *thêm* đơn, hộp, bài viết và ticket demo vào tài khoản. `--clear` chỉ xoá đúng những thứ đó (kể cả thao tác admin hoặc bạn làm live trên chúng), trả lại cảnh cáo/hạn chế cộng đồng và Ritual DNA như lúc trước khi seed. Đơn, hộp, bài viết, điểm thật của tài khoản không bị đụng tới (đã thử: xoá xong vẫn đủ 23 đơn, 4 hộp, 3 bài viết, 5 chat, 209 điểm).
- **Khách demo** cho các case chỉ admin xem, hoặc user ↔ user: `demo.<tên>@example.com`, mật khẩu `Demo@1234`.
- **Staff**: dùng tài khoản Admin CC / CSKH / QLSP có sẵn.
- Đổi tài khoản trình bày: thêm `--presenter USRxxxxx`. Không dùng tài khoản thật: thêm `--no-presenter`, khi đó Chi đóng vai này.
- Mã đơn/hộp bên dưới là của lần seed gần nhất. Mỗi lần seed lại, xem bảng script in ra ở cuối lệnh.

---

## 1. Đơn hàng: giao thất bại và giao lại

Trong code có 4 lý do giao thất bại. 3 lý do đầu là **lỗi phía khách**: khách phải xác nhận giao lại trong 24h. Lý do `carrier_issue` (UI ghi "Carrier issue (our side)") gom chung **lỗi phía Offsite và lỗi phía đơn vị giao hàng**: staff giao lại ngay, không hỏi khách. Sau lần giao đầu, đơn được giao lại tối đa 2 lần.

**Qua lại admin ↔ bạn (USR00005):**

| Đơn | Tình huống | Luồng |
|---|---|---|
| OFS-2026-00149 | Đang giao (COD) | **Admin** chuyển *Delivery failed* và chọn lý do live → **Bạn** nhận thông báo, vào đơn trả lời |
| OFS-2026-00147 | Không liên lạc được, chờ bạn xác nhận (còn khoảng 22h) | **Admin**: nút *Ship again* đang bị khoá → **Bạn**: *Xác nhận giao lại* (sửa SĐT/địa chỉ) → **Admin**: *Ship again* |
| OFS-2026-00152 | Giao thất bại lần 3, hết lượt giao lại, đã trả bằng QR | **Admin**: chỉ còn *Cancel* → **Bạn**: nhập tài khoản ngân hàng nhận hoàn tiền → **Admin**: *Mark refund paid* |

**Chỉ phía admin:**

| Đơn | Phía lỗi | Demo |
|---|---|---|
| OFS-2026-00148 (An, đơn Ritual Box kỳ 2) | Khách (sai địa chỉ), khách đã xác nhận địa chỉ mới | Xem địa chỉ mới → *Ship again* |
| OFS-2026-00150 (An) | GHN (xe gặp sự cố) | *Ship again* ngay |
| OFS-2026-00151 (Bình) | Offsite (kho dán nhầm vận đơn) | *Ship again* ngay. Nhấn mạnh: lỗi phía mình nên không bắt khách chờ |
| OFS-2026-00153 (Bình) | Khách không phản hồi, hệ thống tự huỷ | Hoàn QR đã có STK → *Mark refund paid* |

## 2. Ritual Box: luồng admin ↔ bạn

Quyền theo role: **QLSP** xử lý hết hàng hoặc ngừng bán. **Admin CC** xử lý yêu cầu của khách (bắt buộc mã ticket), lỗi thanh toán và đề xuất. **CSKH** chỉ xem và ghi chú. Những thay đổi ảnh hưởng tới tiền hoặc ngày trừ tiền chỉ là *đề xuất*, khách phải chấp nhận.

| Hộp / đơn | Tình huống | Luồng |
|---|---|---|
| SUB0012 (Tsuyu) | Ticket **CHAT-DEMOPAUSE1**: bạn xin tạm dừng 1 tháng | **Admin CC**: *Pause*, lý do "Customer asked us" + nhập ticket (thử bỏ ticket để thấy bị chặn) → **Bạn** thấy hộp đã tạm dừng |
| SUB0015 (Wilmer Julca) | Đang active nhưng hết hàng | **QLSP**: *Pause* hoặc *Skip*, lý do "Item out of stock" → **Bạn** nhận thông báo |
| SUB0016 (Ichiko) | Admin đã tạm dừng + đề xuất thay bằng Yuki | **Bạn**: chọn món thay cho kỳ này |
| SUB0017 (Ogura) | Bạn tự tạm dừng, admin đề xuất bật lại (còn 2 ngày) | **Bạn**: chấp nhận hoặc từ chối. Hoặc **Admin CC**: *Withdraw proposal* |
| SUB0013 (Cusco) | `payment_failed` (đã thử 2 lần) | **Admin CC**: *Propose resume* → **Bạn**: chấp nhận |
| OFS-2026-00158 (SUB0011, Heza, kỳ 4) | Bạn yêu cầu hoàn tiền vì hư | **Admin** duyệt hoặc từ chối theo policy (hộp vẫn chạy) → **Bạn** thấy kết quả |

**Chỉ phía admin:** Dũng `SUB0014` đang suspended (*Cancel* với lý do "Repeated payment failure", chỉ hiện khi hộp đã bị suspended). Đơn checkout của Dũng không khởi tạo được hộp nằm ở Orders › *Needs attention*. Giang `SUB0018` bị admin huỷ.

## 3. Referral và voucher

**Voucher khiếu nại (admin ↔ bạn)**: ticket **CHAT-DEMOCMP01** (khiếu nại đơn OFS-2026-00152) → **CSKH** tạo voucher khiếu nại cho bạn, gắn đơn đó. Giới hạn ≤20% hoặc ≤ tổng đơn, tối đa 30 ngày, 3 voucher/ngày; thử nhập 25% để thấy báo lỗi → **Bạn** thấy voucher trong ví. QLSP thử tạo voucher khiếu nại thì bị chặn.

**Danh sách voucher (admin)** có đủ trạng thái: `DEMOWINTER15`, `DEMOBLOOM20` (hạng Bloom), `DEMOMATCHA10` (theo danh mục), `DEMOFREESHIP`, `DEMONOEL` (đã lên lịch), `DEMOHALLOWEEN` (hết hạn), `DEMOFLASH50` (hết lượt), `DEMOSTOPPED`, `DEMOREDEEM300` (300 điểm), `CMP-DEMO1`. Admin CC tạo campaign live → xem performance.

**Referral** (user ↔ user, không có admin, nên để ở khách demo): Hà (`HA_DEMO2026`) đã giới thiệu 4 người:

| Bạn | Trạng thái | Demo |
|---|---|---|
| Khoa | `pending` | **Live**: đăng nhập Khoa → đơn OFS-2026-00160 → *Đã nhận hàng* → mở tài khoản Hà: +20 điểm chờ, Khoa nhận voucher WELCOME5 |
| Lan | `awaiting_post` | Điểm đang chờ hết hạn hoàn |
| Minh | `posted` | Đã cộng, Minh đã dùng voucher WELCOME5 |
| Nga | `ineligible` | Trùng SĐT với người giới thiệu (chống gian lận) |

## 4. Starter Quiz và Ritual DNA: cấu hình câu hỏi (admin)

Không seed: DB đang có sẵn quiz release ở trạng thái draft, testing, active. Demo live bằng Admin CC: tạo draft → sửa câu hỏi → *simulate* → testing → active. Với Starter quiz: sửa và sắp xếp câu hỏi → publish → test rule của kit.

## 5. Cộng đồng: cảnh báo và xử lý vi phạm

**Qua lại admin ↔ bạn**: bài `POST600081` của bạn ("Pass lại máy xay…") bị báo cáo 2 lần là lạc đề, vi phạm lần đầu, gợi ý mức 1 → **CSKH**: *Warn* → **Bạn**: nhận thông báo cảnh cáo, bài bị ẩn. Nếu admin chọn đình chỉ, bạn sẽ thấy bị chặn đăng bài. `--clear` sẽ gỡ cảnh cáo/đình chỉ khỏi tài khoản.

**Hàng đợi (admin)**: hệ thống gợi ý mức phạt theo số lần vi phạm trước và mức nặng của lý do.

| Nội dung | Chủ | Báo cáo | Mức gợi ý |
|---|---|---|---|
| Bài spam bán sỉ | Phong (lần đầu) | 3 × spam | Mức 1: cảnh cáo + ẩn |
| Bài pass vé concert | Quân (đã bị cảnh cáo 1 lần) | 2 × off topic | Mức 2: cấm đăng 3 ngày (leo thang theo lịch sử) |
| Bài xúc phạm | Sơn | 2 × inappropriate | Mức 3: chỉ được xem 7 ngày (lý do nặng) |
| Bình luận "matcha fake" | Phong | 2 × misleading | Mức 2 |
| Bio tài khoản | Tú | 2 × spam | Mức 1 |
| Bài whisk matcha của Lan | Xuân báo cáo | 1 × misleading | **Dismiss**: Xuân bị bác 5 lần liên tiếp → nhận cảnh báo, chỉ còn 3 báo cáo/30 ngày |

Tab *Handled*: lịch sử cảnh cáo Quân, đình chỉ Vy. Phía user, Vy (`demo.vy`) đang bị hạn chế 3 ngày: thử đăng bài thì bị chặn, mua hàng vẫn bình thường.
