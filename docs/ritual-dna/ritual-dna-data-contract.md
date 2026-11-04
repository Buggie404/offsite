# Ritual DNA — Data contract v0.1

Ngày đối chiếu: 30/10/2026. Schema, API và cấu hình quiz đã được đưa vào code; seed thật đã tạo 7 câu Ritual DNA và 4 archetype trong MongoDB. Hồ sơ `Users.ritual_dna` chỉ được tạo khi chính user đăng nhập hoàn thành quiz.

## 1. Nguồn và quyết định ưu tiên

- **Quyết định của product owner:** Ritual DNA chỉ dành cho user đăng nhập; radar có năm trục `brightness`, `boldness`, `sweetness`, `skill`, `tempo`. Tài liệu [business rules](ritual-dna-business-rules.md) là bản làm việc cho rule scoring/evolution.
- **Tài liệu lead:** `Project Planning & Prep 2.md`, phần A4, B1 và mục Nhóm 1 — Sản phẩm và Ritual DNA. Tài liệu quy định collection dùng chung, nơi lưu kết quả, phạm vi chỉnh sửa của nhóm.
- **Code hiện có:** Mongoose models trong `backend/src/models`. Cấu trúc hiện tại của Starter Quiz phải được giữ tương thích.
- Nếu tài liệu lead có các phương án mâu thuẫn, quyết định mới hơn của product owner ở trên được áp dụng cho Ritual DNA. Ví dụ: mục MVP lead ghi bốn trục; bản này dùng năm trục. Mục DNA-5 cho guest/estimated DNA chưa áp dụng trong v1.

## 2. Kết quả đọc MongoDB thật

Số liệu dưới đây là **snapshot trước khi seed** từ truy vấn chỉ đọc; không xuất nội dung tài khoản, mật khẩu hay địa chỉ. Sau seed, `QuizConfigs` có thêm 7 câu Ritual DNA và `RitualArchetypes` có 4 document.

| Collection | Hiện có | Ghi chú |
|---|---:|---|
| `Users` | 101 | Cả 101 document hiện chưa có `ritual_dna`; model trước Step 2A chỉ có `ritual_dna_quiz_completed` |
| `Products` | 92 | Có matcha grade, coffee roast/notes, tools type trong model |
| `Recipes` | 35 | Có `metadata.prepTime`, `metadata.difficulty`, `relatedProducts` |
| `Orders` | 108 | Có `order_status`, `delivered_at`, items |
| `QuizConfigs` | 6 | `ritual_dna` có 0 document; các câu hiện có là Starter Quiz |
| `QuizResults` | 42 | Collection dùng chung của Starter Quiz |
| `RitualArchetypes` | 0 | Chưa có collection |
| `UserActivityLogs` | 0 | Chưa có collection |

Số lượng là snapshot tại thời điểm đọc; không dùng làm giả định cố định khi triển khai.

Giá trị catalog quan sát được để chuẩn bị mapping:

- `Products.category`: `coffee`, `drinkware`, `matcha`, `sets_bundles`, `tools`.
- Matcha grade: `barista grade`, `ceremonial grade`, `premium grade`; có record grade rỗng.
- Coffee roast level: `dark roast`, `light roast`, `medium dark roast`, `medium light roast`, `medium roast`.
- Tool type: `brewer`, `chasen`, `chashaku`, `chawan`, `dripper`, `filter`, `grinder`, `kettle`, `whisk stand`.
- Recipe difficulty hiện có: `EASY`, `MEDIUM`; model cho phép `HARD` nhưng hiện chưa có recipe thuộc mức đó.

Vì vậy các ví dụ `bottle`, `French press` hay recipe `HARD` trong business rules chưa được gán điểm từ catalog nếu chưa có mapping sản phẩm cụ thể.

## 3. Quyền sở hữu collection theo tài liệu lead

| Collection / nhánh | Nhóm Ritual DNA làm gì? |
|---|---|
| `Users.ritual_dna` | Được thêm và sửa **chỉ nhánh này** |
| `RitualArchetypes` | Được tạo model/seed và quản lý |
| `QuizConfigs` | Chỉ thêm/chỉnh bản ghi `quiz_type = ritual_dna`; giữ nguyên bản ghi `starter_kit` của nhóm khác |
| `Products` | Nhóm 1 sở hữu; chỉ mở rộng metadata cần thiết cho DNA sau khi chốt mapping với catalog |
| `Recipes`, `BrewSessions`, `Orders` | Chỉ đọc / nhận event; không thay schema của các nhóm phụ trách |
| `QuizResults`, `UserActivityLogs` | Collection dùng chung do nhóm 6 sở hữu; v1 lưu kết quả chính ở `Users.ritual_dna` như lead ghi |

Nếu sau này thay đổi collection so với plan, tài liệu lead yêu cầu cập nhật data collection để đồng đội vẽ ERD. Việc thêm `behavior_events` dưới nhánh `Users.ritual_dna` chưa tạo collection mới.

## 4. User.ritual_dna

V1 dùng **một object hoặc `null`**. `null` nghĩa là user chưa submit quiz; không suy đoán DNA từ lịch sử mua hàng ở phiên bản này.

```ts
type Radar = {
  brightness: number; // 0..100
  boldness: number;   // 0..100
  sweetness: number;  // 0..100
  skill: number;      // 0..100
  tempo: number;      // 0..100
};

type RitualDna = {
  archetype_id: string;           // stable ID, e.g. ARC0001
  archetype_profile_version: number;
  taste_radar: Radar;             // current result after evidence
  quiz_baseline: Radar;           // most recent quiz result before evidence
  quiz_version: string | null;
  quiz_taken_at: Date | null;
  is_estimated: false;            // reserved for future feature
  updated_at: Date;
  last_archetype_change_at: Date | null;
  drink_lean: number | null;      // D1; 0=coffee, 100=matcha
  lean_confirmed: boolean | null;
  equipment_level: 'none' | 'basic' | 'full' | null;
  servings: string[];            // from D6
  occasions: string[];           // from D7
  behavior_events: BehaviorEvent[];
  evolution_logs: EvolutionLog[];
};
```

Hai field `behavior_events` và `evolution_logs` có mục đích khác nhau:

- `behavior_events` giữ bằng chứng có target vector + weight để tính lại radar và reverse khi cần.
- `evolution_logs` giữ lịch sử user nhìn thấy: thời điểm, delta, radar và archetype sau cập nhật.

Lưu ý: `ritual_dna_quiz_completed` đã được loyalty/public profile dùng. Khi kết nối API thật, submit quiz phải cập nhật flag này qua luồng loyalty hiện hữu; không dùng flag đó thay thế hồ sơ DNA.

### 4.1 BehaviorEvent

```ts
type BehaviorEvent = {
  event_id: string;       // deterministic idempotency key
  at: Date;
  source: string;         // e.g. order_delivered, product_saved, recipe_saved
  source_id: string;      // order_id / product_id / recipe_id / brewsession_id
  weight: number;         // 0..10 evidence; không cộng thẳng vào radar
  target_profile: Partial<Radar>;
  rule_version: string;
  reversed_at: Date | null;
};
```

`target_profile` chỉ có các trục có bằng chứng. Ví dụ đơn coffee không nói được user pha nhanh hay chậm thì không có `tempo`.

### 4.2 EvolutionLog

```ts
type EvolutionLog = {
  event_id: string;
  at: Date;
  source: string;
  source_id: string | null;
  rule_version: string;
  delta: Partial<Radar>;
  radar_after: Radar;
  archetype_id: string;
  reversed_at: Date | null;
};
```

Mỗi event phải có `event_id` ổn định. Service tương lai phải kiểm tra event này trước khi append, tránh `order.delivered` tính hai lần. Schema Mongoose không tự bảo đảm unique bên trong array.

### 4.3 Cảnh báo dung lượng

Tài liệu lead ghi `evolution_logs` nằm dưới User. Điều này hợp v1 và số event nhỏ. Khi volume lớn, document User sẽ phình lên; cần đặt ngưỡng và thiết kế archive hoặc collection lịch sử riêng, sau đó cập nhật plan/ERD trước khi đổi. **Không cắt lịch sử âm thầm** chỉ vì thuật toán dùng 20 event gần nhất.

## 5. RitualArchetypes

Model `backend/src/models/RitualArchetype.js` dùng collection `RitualArchetypes`.

| Field | Kiểu | Ý nghĩa |
|---|---|---|
| `archetype_id` | String unique | ID ổn định, không dùng tên làm khóa |
| `name`, `description`, `tagline` | String | Nội dung hiển thị |
| `taste_profile` | Radar | Vector mục tiêu năm trục |
| `recommended_products` | String[] | Chỉ tham chiếu product IDs, recommendation động xử lý ở service khác |
| `badge_icon` | String | Trường dữ liệu cũ để tương thích; không hiển thị trên DNA Card và không chỉnh trong admin |
| `level_thresholds` | Number[] | Trường từ tài liệu lead; chưa kích hoạt gamification DNA riêng |
| `is_active` | Boolean | Chỉ active archetypes tham gia match kết quả mới |
| `profile_version` | Number | Tăng khi vector mục tiêu đổi |

Danh sách đã chốt tên: Zen Purist, Modern Alchemist, Daily Fuel, Cozy Ritualist. Bốn vector đang dùng được ghi trong [business rules](ritual-dna-business-rules.md) và đã seed vào MongoDB. Khi chỉnh vector sau này phải tăng `profile_version` và xử lý phiên bản dữ liệu cũ.

Thay đổi vector archetype không tự reassign tất cả user cũ. Kết quả hiện có lưu `archetype_profile_version` để giải thích lịch sử.

Admin có báo cáo tác động chỉ đọc khi chỉnh một signature trong draft: so archetype gần nhất của các `taste_radar` đang lưu với bản live và bản mô phỏng chỉ thay signature đó. Đây là số liệu mô phỏng, không phải số khách sẽ bị gán lại khi publish; không ghi vào hồ sơ và không phát notification.

## 6. QuizConfigs và QuizResults

`QuizConfigs` đang là collection chung; model hiện có đã hỗ trợ `quiz_type = ritual_dna` và `options[].score_weights` dạng object. Khi tạo dữ liệu quiz:

- Chỉ insert/update các câu `quiz_type = ritual_dna`.
- `question_id` và `option_id` là mã ổn định, ví dụ `DNA_D1`, `DNA_D1_M90`.
- `code` là mã machine-readable, không lấy wording làm identity.
- Weights dùng đúng năm key canonical.
- D1 ghi thuộc tính `drink_lean`, không cộng radar.
- D4/D7 chọn 1–2 đáp án: API trả `selection_limit = 2`, lưu `option_ids[]` trong `Users.ritual_dna.quiz_answers`; các câu khác có `selection_limit = 1`.
- Không đổi schema hoặc document Starter Quiz chỉ để hỗ trợ Ritual DNA.

`QuizResult` hiện có `answers[].option_id` chỉ nhận một ID cho mỗi câu. Theo lead, collection này do nhóm 6 sở hữu. Kết quả chính và câu trả lời Ritual DNA lưu trong `Users.ritual_dna`; v1 không ghi vào `QuizResults`.

**Version quiz:** 7 câu Ritual DNA trong `QuizConfigs` được nhập một lần thành release Active đầu tiên trong `RitualQuizReleases`. Mỗi draft sau đó là snapshot độc lập: `draft` → `testing` → `active`; bản Active cũ thành `archived`. Admin phải chạy mô phỏng đủ 7 câu ở Testing trước khi publish. Có thể tạo nhiều draft song song, nhưng draft dựa trên Active cũ sẽ không publish được sau khi Active thay đổi. API khách hàng chỉ đọc release Active và từ chối submit nếu `quiz_version` đã đổi. Kết quả cũ trong `Users.ritual_dna` vẫn giữ version lúc làm quiz; Starter Quiz không bị sửa.

## 7. Product và Recipe profile

Model `Product` có matcha grade, coffee roast level, coffee tasting notes và tool type. `Recipe` có difficulty, prepTime, ingredients, relatedProducts; `BrewSession` có duration và feedback.

Không nên tự sinh vector cứng khi chưa mapping catalog. Step tiếp theo cần:

1. Kiểm kê giá trị thực của grade, roast, tasting notes, tool type và recipe tags.
2. Viết rule map từng loại sang `Partial<Radar>` cùng `rule_version`.
3. Tính thử với sản phẩm và recipe thật để phát hiện trường thiếu.
4. Chỉ thêm `Product.ritual_profile` nếu rule từ metadata hiện có không đủ ổn định.
5. `Recipe` và `BrewSession` thuộc nhóm khác: ưu tiên đọc field hiện có qua service.

## 8. Luồng ghi dữ liệu dự kiến

```text
User submit quiz
→ Backend validate answer IDs với RitualQuizReleases Active
→ Tính quiz_baseline 5 trục
→ Match RitualArchetypes active
→ Ghi Users.ritual_dna + quiz log
→ Cập nhật completion flag qua loyalty flow

Qualified behavior event
→ Xác minh source (order/recipe/product/brew)
→ Xác định Partial<Radar> và evidence weight
→ Kiểm tra event_id để chống lặp
→ Tính taste_radar mới + candidate archetype
→ Áp dụng margin/confidence/cooldown
→ Ghi behavior_events + evolution_logs vào Users.ritual_dna
```

Retake tạo `quiz_baseline` mới, giữ lịch sử cũ; hành vi cũ vẫn tồn tại và có thể được dùng lại theo rule version đã lưu. Quy tắc có tính lại từ toàn bộ evidence cũ hay khởi động cửa sổ hành vi mới sẽ được quyết định khi làm scoring engine.

## 9. Trạng thái ghi MongoDB

Đã chạy seed có kiểm tra version và chỉ thêm document Ritual DNA còn thiếu: 7 câu trong `QuizConfigs`, 4 archetype trong `RitualArchetypes`. Chưa tạo Ritual DNA thử cho user nào. Backend chấm quiz từ cấu hình thật, kiểm tra answer IDs và version, rồi lưu kết quả vào `Users.ritual_dna` khi user submit. Rule `behavior-1` hiện nối `order.delivered`, order refund, save/unsave product và recipe với Product/Recipe metadata. Các event usage khác và AI còn ở bước sau.
