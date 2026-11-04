# Ritual DNA — Checklist triển khai A–Z

> Mục tiêu: hoàn thiện Ritual DNA cho cả User và Admin, từ quiz ban đầu đến hồ sơ tiến hóa, cá nhân hóa website và AI phân tích.

## Trạng thái hiện tại

- [x] Có route trực tiếp `/ritual-dna`.
- [x] Có prototype UI quiz 7 câu.
- [x] Chọn đáp án tự động chuyển sang câu tiếp theo.
- [x] Khi quay lại câu trước có nút Next để di chuyển thủ công.
- [x] Có prototype màn hình kết quả và radar 5 trục.
- [x] Có mock scoring và mock archetype ở frontend.
- [ ] Chưa kết nối API hoặc database.
- [ ] Chưa có hồ sơ Ritual DNA thật trong Account.
- [ ] Chưa có Admin quản lý Ritual DNA.
- [ ] Chưa có quá trình tiến hóa từ đơn hàng.
- [ ] Chưa có recommendation thật.
- [ ] Chưa tích hợp AI.

## 1. Chốt business rules trước khi code backend

- [ ] Chốt 5 trục DNA theo tài liệu:
  - `umami`  --> brightness
  - `bitterness` --> boldness
  - `sweetness`
  - `skill`
  - `tempo`
- [x] Chốt thang điểm lưu trong database, `0–100` cho cả 5 trục.
- [x] Chốt 7 câu hỏi D1–D7 cho quiz v1.
- [x] D4/D7 chọn 1–2 đáp án; các câu còn lại single-select.
- [x] Chốt answer code ổn định cho từng đáp án, không dùng nội dung hiển thị làm ID.
- [x] Chốt score weight của từng đáp án lên 5 trục cho quiz v1.
- [x] Chốt công thức normalize điểm quiz về `0–100`.
- [ ] Chốt 4 archetype theo tài liệu:
  - Zen Purist
  - Modern Alchemist
  - Daily Fuel
  - Cozy Ritualist
- [x] Chốt vector 5 trục mẫu của từng archetype cho v1.
- [x] Dùng Euclidean distance để tìm archetype gần nhất.
- [x] Nếu bằng khoảng cách, chọn `archetype_id` nhỏ hơn.
- [ ] Chốt mức thay đổi tối thiểu trước khi đổi archetype để tránh hồ sơ nhảy liên tục.
- [ ] Chốt người dùng có được retake quiz hay không và retake ảnh hưởng lịch sử như thế nào.
- [ ] Chốt rule MVP: DNA chỉ tiến hóa khi `order.delivered`.
- [ ] Chốt phần nào thuộc giai đoạn sau: save recipe, community, Brew Coach và hành vi duyệt web.

## 2. Thiết kế database

### 2.1 QuizConfigs

- [x] Tạo schema cấu hình quiz.
- [x] Có `quiz_type = ritual_dna`.
- [x] Lưu version của bộ quiz.
- [ ] Lưu trạng thái `draft`, `active`, `archived`.
- [x] Lưu thứ tự câu hỏi.
- [x] Lưu nội dung câu hỏi và đáp án.
- [x] Lưu answer code.
- [x] Lưu score weights của từng đáp án.
- [ ] Đảm bảo tại một thời điểm chỉ có một version active.

### 2.2 RitualArchetypes

- [x] Tạo schema archetype.
- [ ] Lưu name, slug, tagline và description.
- [x] Lưu vector 5 trục mẫu.
- [ ] Lưu illustration/card theme.
- [x] Lưu trạng thái active/disabled.
- [ ] Lưu perk hoặc voucher nếu feature này được chốt.
- [x] Lưu version để có thể thay đổi archetype mà vẫn audit được kết quả cũ.

### 2.3 Users.ritual_dna

- [x] Mở rộng User schema với `ritual_dna`.
- [x] Lưu archetype hiện tại.
- [x] Lưu radar hiện tại của 5 trục.
- [ ] Lưu nguồn tạo hồ sơ: `quiz`, `estimated`, hoặc `evolved`.
- [x] Lưu quiz version đã sử dụng.
- [x] Lưu thời điểm tạo và cập nhật gần nhất.
- [x] Lưu trạng thái đã hoàn thành quiz.
- [x] Lưu evolution logs hoặc liên kết đến collection lịch sử riêng.
- [ ] Không lưu raw prompt hoặc dữ liệu nhạy cảm không cần thiết.

### 2.4 RitualDnaEvolutionLogs

- [x] Embed evolution logs trong `Users.ritual_dna`.
- [x] Lưu event source cho quiz, order, save và refund.
- [x] Lưu source ID như order ID.
- [x] Lưu radar trước và sau cho event hành vi.
- [x] Lưu delta của từng trục.
- [x] Lưu archetype trước và sau cho event hành vi.
- [x] Lưu rule/version đã áp dụng.
- [x] Dùng event ID để một order không cập nhật DNA hai lần.

### 2.5 Product taste metadata

- [ ] Bổ sung 5 trục phù hợp vào Product hoặc ProductVariant.
- [x] Chốt mapping Product/Recipe metadata cho rule `behavior-1`.
- [ ] Chốt serving, skill level, intensity và occasion nếu dùng cho recommendation.
- [ ] Có dữ liệu mặc định và validation để tránh sản phẩm thiếu profile.
- [ ] Seed metadata cho các sản phẩm hiện có.

### 2.6 AI logs và user activity

- [ ] Tạo `AiCallLogs` nếu cần audit AI.
- [ ] Lưu model, prompt version, latency, status và structured output.
- [ ] Không lưu thông tin cá nhân không cần thiết vào AI logs.
- [ ] Chỉ tạo `UserActivityLogs` khi bắt đầu dùng hành vi ngoài order cho DNA.

## 3. Backend scoring engine

- [x] Tách scoring thành service độc lập, không để logic trong controller.
- [x] Validate user đã trả lời đủ câu bắt buộc.
- [x] Validate answer code thuộc quiz version được gửi lên.
- [x] Tính raw score cho 5 trục.
- [x] Normalize về thang điểm đã chốt.
- [x] So sánh với archetype đang active.
- [x] Áp dụng tie-break rule.
- [ ] Trả confidence hoặc khoảng cách nếu UI cần giải thích kết quả.
- [ ] Lưu quiz result và evolution log trong cùng transaction khi có thể.
- [x] Viết unit test bằng các bộ câu trả lời cố định.
- [x] Bảo đảm cùng input luôn cho cùng output.

## 4. API dành cho User

- [x] `GET /api/ritual-dna/questions` — lấy quiz version active.
- [x] `POST /api/ritual-dna/quiz` — chấm điểm và lưu kết quả.
- [x] `GET /api/ritual-dna/me` — lấy DNA hiện tại và history gần đây của user.
- [ ] `GET /api/ritual-dna/me/history` — lấy lịch sử tiến hóa.
- [x] Retake dùng lại `POST /api/ritual-dna/quiz` với quiz baseline mới.
- [ ] `GET /api/ritual-dna/recommendations` — lấy gợi ý cá nhân hóa.
- [ ] `POST /api/ritual-dna/share` — tạo nội dung/card chia sẻ nếu cần backend.
- [x] Bắt buộc authentication cho toàn bộ dữ liệu Ritual DNA của user.
- [x] Không cho user đọc hoặc sửa DNA của người khác.
- [ ] Có response format và error code thống nhất.

## 5. User — Quiz experience

- [x] Có giao diện quiz cơ bản.
- [x] Tự động next ngay khi chọn câu trả lời.
- [x] Có Back và Next trong review mode.
- [x] Thay dữ liệu hard-code bằng API.
- [x] Hiển thị loading và error state.
- [ ] Disable thao tác trong lúc chuyển câu để tránh chọn hai lần.
- [ ] Lưu tiến độ tạm nếu user refresh hoặc rời trang.
- [ ] Xác nhận hành vi khi user đóng quiz giữa chừng.
- [ ] Hỗ trợ keyboard navigation.
- [ ] Có focus state và screen-reader label.
- [ ] Responsive đầy đủ cho mobile/tablet/desktop.
- [x] Route chính thức chỉ dành cho user đã đăng nhập.
- [ ] Redirect về trang cũ sau khi đăng nhập thành công.
- [ ] Không kết nối hoặc phụ thuộc Starter Kit Quiz.

## 6. User — Result screen

- [x] Có prototype kết quả ở frontend.
- [x] Có radar 5 trục và archetype từ kết quả thật.
- [x] Hiển thị kết quả thật trả về từ API.
- [x] Hiển thị archetype name, tagline và description.
- [x] Hiển thị giá trị 5 trục rõ ràng.
- [ ] Giải thích ngắn vì sao user nhận archetype này.
- [ ] Hiển thị confidence theo ngôn ngữ dễ hiểu nếu sử dụng.
- [ ] Có CTA tiếp tục mua sắm.
- [ ] Có CTA xem sản phẩm hoặc recipe phù hợp.
- [ ] Có Retake quiz theo rule đã chốt.
- [ ] Có Export image.
- [ ] Có Share to Community.
- [ ] Có fallback nếu illustration hoặc AI interpretation lỗi.

## 7. User — My Ritual DNA trong Account

- [x] Bật tab Account tại `/account?tab=dna` (chưa có route riêng `/account/ritual-dna`).
- [x] Hiển thị DNA Card hiện tại.
- [x] Hiển thị radar 5 trục hiện tại.
- [x] So sánh radar hiện tại với quiz baseline khi đã có thay đổi.
- [x] Hiển thị timeline từ evolution logs đã lưu thật.
- [ ] Giải thích event nào làm DNA thay đổi.
- [x] Hiển thị thời điểm cập nhật gần nhất.
- [ ] Hiển thị archetype change nếu có.
- [ ] Có recommendations dành riêng cho profile.
- [ ] Có Retake, Share và Export.
- [x] Có empty state nếu user chưa làm quiz.
- [ ] Có estimated state nếu sau này bật ước lượng từ hành vi.

## 8. DNA evolution từ order.delivered

- [x] Xác định vị trí phát event `order.delivered` trong Order model save hook.
- [x] Chỉ cập nhật DNA khi trạng thái thật sự chuyển sang delivered.
- [x] Không cập nhật lại khi cùng order được save nhiều lần.
- [x] Lấy taste metadata từ các item trong order.
- [x] Tính delta có giới hạn cho từng trục.
- [ ] Chốt cap theo order/ngày để tránh biến động quá mạnh.
- [x] Áp dụng smoothing: behavior tối đa 40%, quiz baseline tối thiểu 60%.
- [x] Kiểm tra lại archetype sau khi radar thay đổi.
- [x] Áp dụng margin 10 và cooldown 7 ngày trước khi đổi archetype.
- [x] Ghi evolution log cho order/save/refund.
- [ ] Gửi notification nếu archetype thay đổi, nếu feature được chốt.
- [ ] Viết test cho duplicate event, refund và cancelled order.

## 9. Personalization và recommendation

- [ ] Chốt các bề mặt được cá nhân hóa:
  - Homepage
  - Product detail — You may also like
  - My Ritual DNA
  - Recipe suggestions
  - Community content nếu cần
- [ ] Xây candidate generation bằng category, availability và business rules.
- [ ] Tính độ phù hợp giữa DNA user và metadata sản phẩm.
- [ ] Loại sản phẩm hết hàng hoặc không thể mua.
- [ ] Có diversity rule để không trả toàn sản phẩm giống nhau.
- [ ] Có fallback cho user chưa có Ritual DNA.
- [ ] Ghi recommendation reason để UI giải thích ngắn.
- [ ] Theo dõi impression, click, add-to-cart và conversion.
- [ ] Không thay thế hoàn toàn logic recommendation hiện có khi chưa A/B test.

## 10. Community và sharing

- [ ] Thiết kế Ritual DNA Card dùng chung giữa Result, Account và Community.
- [ ] Cho user chọn chia sẻ hoặc không; không tự động đăng.
- [ ] Tạo community post với archetype snapshot.
- [ ] Quyết định card hiển thị radar chi tiết hay chỉ archetype.
- [ ] Cho phép bấm badge/card để mở modal xem hồ sơ public.
- [ ] Không lộ evolution history hoặc dữ liệu mua hàng.
- [ ] Có Export image với kích thước phù hợp social media.
- [ ] Xử lý quyền riêng tư khi user xóa post hoặc tắt chia sẻ.

## 11. AI analysis

### 11.1 Nguyên tắc

- [ ] Deterministic rule engine chịu trách nhiệm tính điểm và gán archetype.
- [ ] AI không tự ý sửa radar hoặc archetype trong database.
- [ ] AI dùng để diễn giải kết quả và re-rank recommendation.
- [ ] AI output bắt buộc theo JSON schema.
- [ ] Có timeout, retry có giới hạn và deterministic fallback.
- [ ] Không chặn quiz result nếu AI lỗi.

### 11.2 AI interpretation

- [ ] Gửi radar, archetype và signal đã được làm sạch cho AI.
- [ ] Nhận summary ngắn về ritual/vibe của user.
- [ ] Nhận 2–3 lý do giải thích kết quả.
- [ ] Nhận recommendation themes thay vì để AI bịa product ID.
- [ ] Chỉ cho AI chọn từ danh sách sản phẩm backend cung cấp.
- [ ] Lưu prompt version để có thể audit.
- [ ] Cache interpretation cho cùng DNA version.

### 11.3 AI recommendation re-ranking

- [ ] Backend tạo candidate products trước.
- [ ] AI chỉ re-rank candidate list đã hợp lệ.
- [ ] Yêu cầu AI trả product IDs thuộc danh sách đầu vào.
- [ ] Validate output trước khi trả cho frontend.
- [ ] Fallback về rule-based ranking nếu AI lỗi.
- [ ] Đo latency, token cost và conversion uplift.

### 11.4 Privacy và safety

- [ ] Không gửi email, địa chỉ, payment hoặc raw order data không cần thiết.
- [ ] Có disclosure rằng phần diễn giải được AI hỗ trợ nếu yêu cầu sản phẩm cần.
- [ ] Cho phép regenerate nhưng có rate limit.
- [ ] Có moderation cho nội dung AI dùng để share lên Community.

## 12. Admin — Quiz management

- [x] Tạo page `/admin/ritual-dna` cho `admin_cc` (menu đã có sẵn).
- [x] Danh sách quiz versions và số hồ sơ theo version ở chế độ chỉ đọc.
- [ ] Tạo, sửa và sắp xếp câu hỏi.
- [ ] Tạo, sửa và sắp xếp đáp án.
- [ ] Cấu hình score weight trên 5 trục.
- [ ] Preview quiz trước khi publish.
- [ ] Validate quiz đủ câu và đủ weight.
- [ ] Publish version mới.
- [ ] Archive version cũ, không xóa dữ liệu lịch sử.
- [ ] Hiển thị số user đã dùng từng version.

## 13. Admin — Archetype management

- [x] Danh sách archetypes từ MongoDB và số user mỗi archetype.
- [ ] Add/Edit archetype.
- [ ] Chỉnh name, tagline, description và illustration.
- [ ] Chỉnh vector mẫu 5 trục.
- [x] Có radar preview cho archetype được chọn (chế độ chỉ đọc).
- [ ] Enable/disable archetype.
- [ ] Không hard-delete archetype đang được user tham chiếu.
- [ ] Preview số user có thể bị ảnh hưởng khi thay đổi vector.
- [ ] Chọn chỉ áp dụng cho kết quả mới hoặc reassign user cũ.
- [ ] Nếu reassign, chạy background job và ghi audit log.

## 14. Admin — Evolution rules

- [ ] Cấu hình event được phép làm DNA tiến hóa.
- [ ] MVP chỉ bật `order.delivered`.
- [ ] Cấu hình XP/delta/cap nếu dùng points & levels.
- [ ] Cấu hình smoothing và threshold đổi archetype.
- [ ] Có worked example trước khi lưu rule.
- [ ] Rule mới chỉ áp dụng từ thời điểm publish, trừ khi có migration rõ ràng.
- [ ] Có audit log người thay đổi rule.

## 15. Admin — Customer, AI và analytics

- [ ] Xem DNA hiện tại của từng customer.
- [ ] Xem evolution history.
- [ ] Xem nguồn thay đổi và order liên quan.
- [ ] Có quyền admin riêng cho việc chỉnh DNA thủ công.
- [ ] Mọi chỉnh sửa thủ công phải có reason và audit log.
- [ ] Quản lý AI model, prompt version và trạng thái bật/tắt.
- [ ] Có kill switch để tắt AI và dùng fallback.
- [x] Dashboard quiz completion rate cơ bản từ số hồ sơ / số customer.
- [x] Dashboard phân bố archetype cơ bản từ số hồ sơ đã lưu.
- [ ] Dashboard recommendation CTR/conversion.
- [ ] Dashboard AI error, latency và cost.

## 16. Security, performance và reliability

- [ ] Authentication và role authorization đầy đủ.
- [ ] Validate request bằng schema.
- [ ] Rate limit quiz submit, retake, export và AI regenerate.
- [ ] Chống user giả answer score hoặc archetype từ frontend.
- [ ] Backend luôn tự tính kết quả từ answer codes.
- [ ] Index các field truy vấn thường xuyên.
- [ ] Cache quiz config và archetype config active.
- [ ] Background job cho reassign hàng loạt hoặc AI batch.
- [ ] Có retry/idempotency cho order event.
- [ ] Có logging, metrics và error monitoring.
- [ ] Có chính sách xóa/export dữ liệu Ritual DNA của user.

## 17. Testing

### Unit tests

- [ ] Scoring từng đáp án.
- [ ] Normalize 5 trục.
- [ ] Archetype matching.
- [ ] Tie-break.
- [ ] Evolution delta và cap.
- [ ] Recommendation score.
- [ ] AI output validation và fallback.

### Integration tests

- [ ] Submit quiz → lưu User DNA → tạo evolution log.
- [ ] Retake quiz → cập nhật đúng theo rule.
- [ ] Order delivered → DNA chỉ cập nhật một lần.
- [ ] Archetype change → history đúng.
- [ ] Admin publish config → User nhận version mới.
- [ ] AI timeout → vẫn trả result/recommendations bằng fallback.

### End-to-end tests

- [ ] User đăng nhập và hoàn thành 7 câu.
- [ ] Auto-next và Back/Next hoạt động đúng.
- [ ] Result khớp với dữ liệu API.
- [ ] My Ritual DNA hiển thị card, radar và history.
- [ ] Share to Community hoạt động đúng quyền riêng tư.
- [ ] Admin tạo và publish quiz/archetype.
- [ ] Responsive và accessibility trên các breakpoint chính.

## 18. Seed, migration và deployment

- [x] Seed 7 câu hỏi và score matrix đã chốt.
- [x] Seed 4 archetypes và vector mẫu.
- [ ] Seed metadata cho product hiện có.
- [ ] Migration User schema an toàn cho account cũ.
- [ ] Feature flag cho quiz, evolution, recommendation và AI.
- [ ] Staging test với dữ liệu giả lập.
- [ ] Backup database trước migration production.
- [ ] Có rollback plan cho schema/config và AI.
- [ ] Theo dõi error và conversion sau khi release.

## Thứ tự triển khai đề xuất

- [x] **Bước 1:** Chốt 7 câu hỏi, answer codes, score matrix và 4 archetype vectors cho v1.
- [x] **Bước 2:** Thiết kế schema, seed data và backend scoring engine cho quiz v1.
- [x] **Bước 3:** Tạo API quiz và nối UI hiện tại với dữ liệu thật.
- [ ] **Bước 4:** Hoàn thiện Result và trang My Ritual DNA.
- [ ] **Bước 5:** Tích hợp `order.delivered` và evolution history.
- [ ] **Bước 6:** Xây Admin Quiz và Archetype Management.
- [ ] **Bước 7:** Xây rule-based personalization/recommendation.
- [ ] **Bước 8:** Hoàn thiện Share, Export và Community card.
- [ ] **Bước 9:** Tích hợp AI interpretation và AI re-ranking có fallback.
- [ ] **Bước 10:** Hoàn thiện Admin AI/Analytics, testing, security và deployment.

## Definition of Done

Ritual DNA chỉ được xem là hoàn thiện khi:

- [ ] User đăng nhập có thể làm quiz và kết quả được lưu thật.
- [ ] Kết quả gồm radar 5 trục và archetype đúng theo rule đã version hóa.
- [ ] User xem được DNA Card, radar và lịch sử trong Account.
- [ ] Mỗi order delivered chỉ làm DNA tiến hóa đúng một lần.
- [ ] Recommendation cập nhật theo DNA và có fallback.
- [ ] User chủ động share/export mà không lộ dữ liệu riêng tư.
- [ ] Admin quản lý được quiz, archetype và evolution rules có audit/version.
- [ ] AI diễn giải và re-rank an toàn; AI lỗi không làm hỏng luồng chính.
- [ ] Unit, integration và E2E tests quan trọng đều pass.
- [ ] Có monitoring, privacy handling, migration và rollback plan.

## Các quyết định còn cần chốt

- [ ] Nội dung chính xác của 7 câu hỏi và đáp án.
- [x] D4/D7 chọn 1–2 đáp án; điểm lấy trung bình nếu chọn hai.
- [ ] Score matrix cuối cùng.
- [ ] Vector cuối cùng của 4 archetypes.
- [ ] Rule retake quiz.
- [ ] Công thức evolution từ product metadata.
- [ ] Khi nào đổi archetype.
- [ ] Có dùng points/levels và perks trong scope chính thức không.
- [ ] Recommendation áp dụng ngay ở những trang nào.
- [ ] AI provider/model và giới hạn chi phí.

