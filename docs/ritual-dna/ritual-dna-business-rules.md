# Ritual DNA — Business Rules

> Tài liệu tổng hợp các quyết định và rule đã brainstorm cho Ritual DNA của Offsite. Nội dung UI trong wireframe chỉ dùng để tham khảo; business logic, dữ liệu và cách tính tuân theo tài liệu này sau khi được chốt.

## 1. Mục tiêu

Ritual DNA là hồ sơ cá nhân hóa mô tả đồng thời:

1. User thích nhóm hương vị nào.
2. User thích cường độ và độ ngọt béo ra sao.
3. User có mức độ quan tâm đến kỹ thuật pha chế như thế nào.
4. User duy trì ritual theo nhịp chậm rãi hay nhanh gọn.

Ritual DNA được tạo lần đầu từ quiz, sau đó có thể tiến hóa từ các hành vi đủ đáng tin cậy trên website.

Ritual DNA được dùng để:

- Cá nhân hóa Homepage.
- Cá nhân hóa Product Detail — You may also like.
- Gợi ý sản phẩm, recipe và dụng cụ phù hợp.
- Hiển thị DNA Card và lịch sử tiến hóa trong Account.
- Hỗ trợ AI diễn giải hồ sơ và re-rank recommendation.
- Cho phép user chủ động chia sẻ DNA Card lên Community.

Ritual DNA không thay thế Starter Kit Quiz. Hai quiz độc lập về mục tiêu và dữ liệu.

---

## 2. Các quyết định đã chốt

### 2.1 Phạm vi người dùng

- Ritual DNA chỉ dành cho user đã đăng nhập.
- Guest không tạo hoặc lưu Ritual DNA.
- Starter Kit Quiz có thể dành cho cả guest và user nhưng không tác động Ritual DNA.

### 2.2 Năm trục DNA

Đã chốt dùng năm trục:

```text
brightness
boldness
sweetness
skill
tempo
```

Mỗi trục được chuẩn hóa về thang `0–100`.

| Trục | 0 điểm | 100 điểm | Ý nghĩa |
|---|---|---|---|
| `brightness` | Rang, trầm, earthy | Tươi sáng, xanh, fruity, floral | Hướng hương vị user bị thu hút |
| `boldness` | Nhẹ, delicate | Đậm, mạnh, rõ vị | Cường độ user mong muốn |
| `sweetness` | Clean, nguyên bản, ít ngọt | Ngọt, béo, creamy | Mức user thích milk, sweetness và texture mềm |
| `skill` | Pha đơn giản, ít dụng cụ | Kỹ thuật, nhiều dụng cụ, thích kiểm soát | Mức quan tâm và kinh nghiệm pha chế |
| `tempo` | Ritual chậm rãi | Nhanh gọn, tiện lợi | Nhịp pha và sử dụng đồ uống |

Quy ước quan trọng:

- Tempo càng cao thì ritual càng nhanh và tiện.
- Brightness không phải độ đậm.
- Boldness mới là trục nhẹ–đậm.
- Sweetness đo xu hướng clean/original so với sweet/creamy.
- Năm trục là dữ liệu chi tiết; archetype chỉ là nhãn diễn giải.

### 2.3 Giá sản phẩm

- Không hỏi budget trong bảy câu Ritual DNA.
- Giá không tác động năm trục.
- Giá không tác động archetype.
- Không dùng lịch sử giá để hard-filter sản phẩm.
- Có thể học nhẹ mức giá thường mua để làm soft ranking signal.
- Recommendation vẫn phải cho user thấy sản phẩm ở nhiều khoảng giá khác nhau.
- Không được suy luận khả năng tài chính của user từ lịch sử mua hàng.

### 2.4 Nguyên tắc scoring

Ba hệ điểm phải tách biệt:

```text
Radar score      = giá trị 0–100 của năm trục DNA
Evidence point   = độ tin cậy tương đối của một hành vi
Loyalty/XP point = điểm thành viên, không liên quan DNA
```

- Evidence point không cộng thẳng vào radar.
- AI không trực tiếp tính hoặc sửa radar.
- Backend rule engine chịu trách nhiệm scoring và archetype matching.

---

## 3. Vì sao sử dụng năm trục này?

Năm trục chia thành hai nhóm:

```text
Taste  = Brightness + Boldness + Sweetness
Ritual = Skill + Tempo
```

Nếu bỏ Tempo, hệ thống chủ yếu chỉ còn hồ sơ khẩu vị và kỹ năng, chưa phản ánh đầy đủ cách user thực hiện ritual.

### 3.1 Brightness

Brightness đo hướng hương vị, không đo độ mạnh.

Ví dụ Brightness cao:

- Matcha xanh tươi, ceremonial.
- Coffee light roast.
- Citrus, berry, peach, floral.
- Hương vị thanh và có độ chua sáng.

Ví dụ Brightness thấp:

- Dark roast.
- Dark cacao, smoke, toasted nuts.
- Hōjicha hoặc profile thiên rang.
- Hương vị trầm và earthy.

### 3.2 Boldness

Boldness đo intensity/body/presence.

Ví dụ Boldness cao:

- Espresso đậm.
- Dark roast.
- Barista matcha.
- Đồ uống qua sữa hoặc đá vẫn giữ rõ vị.

Ví dụ Boldness thấp:

- Pour-over nhẹ.
- Matcha thanh.
- Đồ uống clean và delicate.

### 3.3 Sweetness

Sweetness đo xu hướng clean/original so với sweet/creamy.

Ví dụ Sweetness cao:

- Latte.
- Caramel, vanilla, chocolate.
- Milk hoặc oat milk.
- Syrup và texture creamy.

Ví dụ Sweetness thấp:

- Matcha nguyên bản.
- Espresso hoặc americano không đường.
- Pour-over clean.

Trong MVP, sweetness và creaminess được gộp thành một trục để tránh tăng số chiều lên sáu.

### 3.4 Skill

Skill đo cả năng lực hiện tại và mức độ hứng thú với kỹ thuật pha chế.

- Không có dụng cụ và không quan tâm: thấp.
- Chưa biết nhưng muốn học: trung bình.
- Có setup riêng, làm recipe khó, biết điều chỉnh: cao.

### 3.5 Tempo

Tempo phản ánh cách user sử dụng đồ uống:

- Thấp: chậm rãi, thưởng thức quá trình pha.
- Cao: nhanh, tiện, đều đặn, phục vụ công việc hoặc di chuyển.

Tempo đặc biệt hữu ích để phân biệt Daily Fuel với Zen Purist.

---

## 4. Thuộc tính phụ

Thuộc tính phụ không tham gia trực tiếp vào khoảng cách archetype. Chúng giúp recommendation cụ thể hơn đối với hai user có cùng archetype.

| Thuộc tính | Nguồn ban đầu | Công dụng |
|---|---|---|
| `drink_lean` | D1 | Ưu tiên matcha hay coffee |
| `lean_confirmed` | D1 | Biết preference đã rõ hay chưa |
| `equipment_level` | D3 | Không gợi ý recipe hoặc tool vượt quá khả năng |
| `flavor_tags` | D4 | Giải thích và lọc flavor recommendation |
| `intensity_preference` | D5 | Hỗ trợ chọn roast/grade và recipe |
| `servings` | D6 | Gợi ý hot, iced, milk hoặc mixed |
| `occasions` | D7 | Gợi ý theo morning, work, afternoon, evening, social |
| `observed_price_preference` | Lịch sử mua | Soft ranking, không hard-filter |

Một đáp án có thể đồng thời:

1. Cộng raw score vào một hoặc nhiều trục.
2. Ghi thuộc tính phụ.

Ví dụ:

```text
D6: Với sữa

Radar contribution:
sweetness +5

Profile attribute:
servings += milk
```

### 4.1 Price preference

Nếu cần, hệ thống có thể lưu nội bộ:

```ts
observedPricePreference: {
  averagePurchasedPrice: number,
  commonPriceRange: {
    min: number,
    max: number
  },
  confidence: number
}
```

Field này:

- Không xuất hiện trên DNA Card.
- Không quyết định archetype.
- Chỉ điều chỉnh nhẹ thứ tự recommendation.
- Không loại bỏ hoàn toàn sản phẩm ngoài khoảng giá đã quan sát.

---

## 5. Bốn archetype

Archetype là profile mẫu gồm năm giá trị. User được gán archetype có vector gần radar của họ nhất.

### 5.1 Danh sách đang đề xuất

| Archetype | Mô tả |
|---|---|
| Zen Purist | Thanh, nguyên bản, quan tâm kỹ thuật và ritual chậm |
| Modern Alchemist | Tò mò, thích dụng cụ, thử recipe và cách kết hợp mới |
| Daily Fuel | Đậm, nhanh, thực dụng, cần năng lượng đều đặn |
| Cozy Ritualist | Ngọt béo, dễ uống, thư giãn và thiên về comfort |

> Tên thứ tư đã chốt là `Cozy Ritualist`, bao phủ cả matcha và coffee theo cảm giác comfort, không giới hạn ở latte.

### 5.2 Vector quiz v1 đang dùng

| Archetype | Brightness | Boldness | Sweetness | Skill | Tempo |
|---|---:|---:|---:|---:|---:|
| Zen Purist | 69 | 18 | 22 | 60 | 28 |
| Modern Alchemist | 62 | 39 | 54 | 75 | 51 |
| Daily Fuel | 25 | 80 | 25 | 32 | 88 |
| Cozy Ritualist | 27 | 20 | 82 | 28 | 35 |

Các vector này đã được hiệu chỉnh bằng mô phỏng các tổ hợp câu trả lời hợp lệ và seed vào MongoDB dưới `profile_version = 1`. Phân bố mô phỏng xấp xỉ: Zen 23%, Modern 22%, Daily 27%, Cozy 28%; đây không phải tỷ lệ khách hàng thực. Khi có dữ liệu sử dụng thật cần tiếp tục:

- Chạy toàn bộ tổ hợp câu trả lời hợp lệ.
- Kiểm tra tỷ lệ phân bố của bốn archetype.
- Tránh một archetype chiếm đa số kết quả.
- Kiểm tra các bộ đáp án đại diện có trả về đúng archetype mong đợi.
- Hiệu chỉnh bằng dữ liệu thật sau khi có đủ user.

---

## 6. Bộ bảy câu hỏi Ritual DNA

### D1 — Drink lean

**Câu hỏi:** Nếu chỉ được chọn một loại cho cả tuần, bạn sẽ chọn gì?

| Đáp án | `drink_lean` | Radar contribution |
|---|---:|---|
| Matcha gần như mỗi ngày | 90 | Không có |
| Chủ yếu matcha | 70 | Không có |
| Cả hai như nhau | 50 | Không có |
| Chủ yếu coffee | 30 | Không có |
| Coffee gần như mỗi ngày | 10 | Không có |
| Chưa có thói quen rõ | 50, `lean_confirmed = false` | Không có |

D1 không tác động radar vì lựa chọn matcha/coffee không quyết định archetype.

### D2 — Ritual duration

**Câu hỏi:** Với ly đầu tiên trong ngày, bạn thường có bao lâu để pha và thưởng thức?

| Đáp án | Skill | Tempo |
|---|---:|---:|
| Dưới 3 phút, thường vừa đi vừa uống | 0 | 5 |
| Khoảng 5–10 phút, một khoảng nghỉ ngắn | 2 | 3 |
| Từ 15 phút, quá trình pha cũng là lúc thư giãn | 4 | 1 |

### D3 — Equipment relationship

**Câu hỏi:** Điều nào mô tả đúng nhất cách bạn dùng dụng cụ pha chế?

| Đáp án | Skill | `equipment_level` |
|---|---:|---|
| Chỉ cần cốc và nước nóng | 0 | none |
| Có một vài món cơ bản | 2 | basic |
| Chưa giỏi nhưng muốn học | 3 | basic |
| Có setup riêng và thích kiểm soát cách pha | 5 | full |

### D4 — Flavor direction

**Câu hỏi:** Chọn tối đa hai nhóm hương vị bạn thường bị thu hút nhất.

| Đáp án | Brightness | Boldness | Sweetness |
|---|---:|---:|---:|
| Xanh tươi, floral, citrus, fruit | 5 | 0 | 1 |
| Caramel, milk chocolate, vanilla | 1 | 1 | 5 |
| Dark cacao, smoke, roasted nuts | 0 | 5 | 1 |
| Creamy, milky, smooth | 0 | 1 | 5 |
| Gentle, nutty, lightly roasted | 1 | 2 | 2 |

Nếu chọn hai đáp án, hệ thống lấy trung bình contribution của hai đáp án, không cộng dồn.

### D5 — Intensity

**Câu hỏi:** Một ly đúng gu của bạn nên đậm đến đâu?

| Đáp án | Brightness | Boldness |
|---|---:|---:|
| Nhẹ, clean, uống lâu không mệt | 3 | 0 |
| Cân bằng, rõ vị nhưng tròn | 2 | 2 |
| Đậm và có presence rõ rệt | 0 | 4 |
| Qua sữa hoặc đá vẫn phải giữ được vị | 0 | 5 |

### D6 — Serving style

**Câu hỏi:** Bạn thường thích thưởng thức theo cách nào nhất?

| Đáp án | Brightness | Sweetness | Skill | `servings` |
|---|---:|---:|---:|---|
| Nóng và nguyên bản | 2 | 0 | 1 | hot |
| Uống với đá | 1 | 2 | 0 | iced |
| Uống cùng sữa | 0 | 5 | 0 | milk |
| Pha với tonic, fruit, syrup hoặc nguyên liệu khác | 2 | 3 | 4 | mixed |

### D7 — Occasion

**Câu hỏi:** Bạn thường tìm đến matcha hoặc coffee vào lúc nào?

| Đáp án | Boldness | Sweetness | Skill | Tempo | `occasions` |
|---|---:|---:|---:|---:|---|
| Buổi sáng để bắt đầu ngày mới | 0 | 0 | 0 | 5 | morning |
| Khi làm việc và cần tập trung | 1 | 0 | 0 | 4 | work |
| Buổi chiều để nghỉ giữa giờ | 0 | 0 | 0 | 2 | afternoon |
| Buổi tối để thư giãn | 0 | 1 | 0 | 0 | evening |
| Khi gặp bạn bè hoặc tiếp khách | 0 | 0 | 2 | 1 | social |

### 6.1 Single-select và multi-select

Đã chốt:

- D1, D2, D3, D5, D6 là single-select và tự động next ngay.
- D4 và D7 cho chọn tối đa hai đáp án.
- Sau lựa chọn đầu tiên ở D4/D7, hiển thị `Continue with 1 choice`.
- Nếu user chọn đáp án thứ hai, tự động next.
- Nếu user quay lại câu cũ, hiển thị nút Next để di chuyển thủ công.

Hai câu D4/D7 là ngoại lệ có chủ đích đối với auto-next: chọn đáp án thứ hai thì tự chuyển; nếu chỉ chọn một thì bấm Continue.

---

## 7. Tính radar từ quiz

Raw score của mỗi trục là tổng contribution của các câu liên quan.

Với câu multi-select D4/D7:

```text
question contribution = trung bình contribution của các đáp án đã chọn
```

Sau đó normalize về `0–100`:

```text
normalizedScore =
  (rawScore - minimumPossible) /
  (maximumPossible - minimumPossible)
  × 100
```

Range đang đề xuất theo score matrix:

| Trục | Raw min | Raw max |
|---|---:|---:|
| Brightness | 0 | 10 |
| Boldness | 0 | 11 |
| Sweetness | 1 | 11 |
| Skill | 0 | 15 |
| Tempo | 1 | 10 |

Mọi output phải clamp trong `0–100`.

Trước khi khóa range phải chạy test toàn bộ tổ hợp đáp án hợp lệ, đặc biệt khi D4/D7 là multi-select.

---

## 8. Gán archetype

Hệ thống dùng Euclidean distance trên năm trục:

```text
distance = √(
  (user.brightness - archetype.brightness)² +
  (user.boldness   - archetype.boldness)² +
  (user.sweetness  - archetype.sweetness)² +
  (user.skill      - archetype.skill)² +
  (user.tempo      - archetype.tempo)²
)
```

Archetype có distance nhỏ nhất là candidate gần nhất.

Phải chốt thêm tie-break rule ổn định. Không được chọn ngẫu nhiên khi hai distance bằng nhau.

---

## 9. Behavioral evidence

### 9.1 Nguyên tắc

- Hành vi thể hiện intent hoặc usage thật mới được tác động DNA.
- Search/view/click thông thường không được đổi DNA.
- Save được tác động nhẹ vì thể hiện interest có chủ đích.
- Purchase mạnh hơn save.
- Actual usage mạnh hơn purchase.
- Một event chỉ được ghi nhận một lần.
- Không cộng thẳng evidence point vào radar.

### 9.2 Evidence scale

Evidence weight dùng thang `0–10` cho một event đơn lẻ.

| Event | Evidence weight | Ghi chú |
|---|---:|---|
| Search | 0 | Chỉ dùng session recommendation |
| View Product Detail | 0 | Chỉ dùng session recommendation |
| Like Community post | 0 | Chỉ dùng feed ranking |
| Follow user | 0 | Chỉ dùng social graph |
| Add to cart chưa mua | 0 | Recommendation intent, chưa đổi DNA |
| Save product | 1 | Interest nhẹ |
| Save recipe | 2 | Có nhiều context hơn product |
| Add manual Pantry item | 2 | Chỉ khi metadata đủ |
| Order delivered | 6 | Purchase đã hoàn tất |
| Review 4–5 sao | +3 | Reinforce evidence của order |
| Recipe completed | 7 | Actual usage |
| Repeat purchase cùng profile | 8 | Preference lặp lại |
| Subscription cycle delivered | 8 | Ritual ổn định |
| Recipe do user tạo được publish | 8 cho Skill | Thể hiện khả năng thực hành |
| BrewSession hoàn thành, rating ≥ 4 | 10 | Signal mạnh nhất hiện có |

`10` là weight tối đa đề xuất cho một event, không phải radar score tối đa.

Tổng evidence có thể lớn hơn 10.

### 9.3 Save limits

- Tối đa ba product-save evidence mỗi ngày.
- Tối đa ba recipe-save evidence mỗi ngày.
- Một item chỉ tạo evidence một lần.
- Save rồi unsave làm evidence cũ inactive.
- Save lại cùng item không tạo evidence mới.
- Không nhân evidence theo số lần click.

### 9.4 Order quantity

Không nhân tuyến tính evidence theo quantity. Mua năm sản phẩm giống nhau không được mạnh gấp năm lần.

Đề xuất quantity multiplier:

```text
quantityMultiplier = min(1 + 0.25 × (quantity - 1), 1.5)
```

### 9.5 Refund/return

- Event phải có idempotency key.
- Một order delivered chỉ tạo evidence một lần.
- Nếu order được refund/return sau đó, evidence liên quan phải được reverse hoặc inactive.
- Không tạo delta đối nghịch tùy ý.

---

## 10. BrewSession

BrewSession là một lần user thực sự sử dụng Brew Coach, hoàn thành recipe và lưu feedback.

Flow:

```text
Mở Recipe
→ Start Brew Coach
→ Làm theo từng bước
→ Hoàn thành
→ Gửi feedback
→ Lưu BrewSession
```

BrewSession hiện có thể lưu:

- Recipe đã pha.
- `started_at`.
- `brewed_at`.
- `duration_seconds`.
- `feedback.flavor_intensity`.
- `feedback.rating`.
- Ingredient adjustments.
- Ingredients actually used.
- Pantry deductions.
- Result image.

Mapping:

| BrewSession data | Trục liên quan |
|---|---|
| Recipe/product profile | Brightness, Boldness, Sweetness |
| Recipe difficulty | Skill |
| Ingredient adjustments | Brightness, Boldness, Sweetness, có thể Skill |
| Actual duration | Tempo |
| Rating | Quyết định mức reinforce |

Một BrewSession có chất lượng evidence cao khi:

- User hoàn thành flow.
- Duration hợp lệ.
- Feedback hợp lệ.
- Rating từ 4–5.

Đề xuất theo rating:

| Rating | Xử lý |
|---|---|
| 4–5 | Evidence weight 10, reinforce đầy đủ |
| 3 | Evidence weight 4–5, mức trung tính |
| 1–2 | Không reinforce DNA; ghi negative affinity cho recommendation |

Rating thấp không tự động đẩy radar sang hướng đối nghịch.

---

## 11. Mapping hành vi website sang trục

### 11.1 Product

| Product data | Brightness | Boldness | Sweetness | Skill | Tempo |
|---|:---:|:---:|:---:|:---:|:---:|
| Matcha grade | ✓ | ✓ | ✓ |  |  |
| Coffee roast level | ✓ | ✓ |  |  |  |
| Coffee tasting notes | ✓ |  | ✓ |  |  |
| Tool type |  |  |  | ✓ | Có thể, yếu |
| Generic mug/drinkware |  |  |  |  |  |
| Set/bundle | Vector trung bình có trọng số của component | | | | |

Generic mug hoặc drinkware không đủ thông tin để tác động DNA.

### 11.2 Tool delivered

| Tool group | Target Skill | Target Tempo | Evidence |
|---|---:|---:|---:|
| Mug hoặc generic drinkware | Không tác động | Không tác động | 0 |
| Shaker/bottle tiện lợi | 30 | 85 | 4 |
| French press/basic whisk | 55 | Không xác định | 5 |
| Chasen/chawan | 75 | 30 | 6 |
| Dripper/kettle/grinder | 85 | 35 | 6 |

Các giá trị là target profile, không phải điểm cộng trực tiếp.

### 11.3 Recipe

| Recipe data | Trục liên quan |
|---|---|
| Related products | Brightness, Boldness, Sweetness |
| Ingredients | Brightness, Boldness, Sweetness |
| Difficulty | Skill |
| Prep time | Tempo |
| Tools | Skill |

### 11.4 Community

- Like post: không tác động DNA.
- Save post: mặc định không tác động DNA.
- Save recipe post: dùng rule Save Recipe nếu có recipe ID hợp lệ.
- Product-tag click: recommendation session only.
- Tạo post thường: không tác động DNA.
- Tạo recipe được publish: có thể tạo Skill evidence.
- Share DNA Card: không tác động radar.

### 11.5 AI chat

- Nội dung chat không được tự động dùng để sửa DNA.
- AI có thể đọc profile khi personalization được bật.
- AI có thể đề xuất user retake hoặc xác nhận preference.
- Mọi thay đổi radar vẫn phải đi qua rule engine hoặc hành động xác nhận rõ ràng của user.

---

## 12. Tính behavioral radar

### Mapping Product/Recipe đã nối trong backend v1

Backend hiện đọc metadata thật của Product và Recipe để tạo **target profile**; các giá trị dưới đây không cộng trực tiếp vào radar. Event `order.delivered` có weight 6, save product weight 1, save recipe weight 2.

| Metadata | Target axes |
|---|---|
| Matcha ceremonial / premium / barista grade | Brightness 72/58/35; Boldness 30/45/65 |
| Coffee light / medium light / medium / medium dark / dark roast | Brightness 82/70/52/34/20; Boldness 25/40/52/70/85 |
| Coffee có tasting notes trái cây/citrus | Tăng target Brightness theo trung bình với 78 |
| Coffee có notes caramel/chocolate/vanilla và nhóm tương tự | Sweetness target 65 |
| Chasen/chawan/chashaku | Skill 75, Tempo 30 |
| Dripper/kettle/grinder | Skill 85, Tempo 35 |
| French press và brewer khác | Skill 55 hoặc 65 |
| Drinkware và bundle không có composition | Không tạo signal |
| Recipe difficulty EASY/MEDIUM/HARD | Skill 25/55/85 |
| Recipe prepTime ≤5 / ≤10 / ≤20 / >20 phút | Tempo 85/65/40/20 |

Order lấy trung bình có trọng số của các item có signal; quantity multiplier giới hạn ở 1.5. Trục thiếu signal giữ nguyên. Save/unsave giới hạn 3 evidence mỗi loại mỗi ngày; save lại cùng item sau khi unsave không tạo evidence mới. Refund toàn bộ gỡ evidence của order; refund một phần tính lại target từ các item còn giữ, rồi tính lại radar từ các event còn active. Retake mở baseline mới; evidence cũ vẫn nằm trong lịch sử nhưng không ảnh hưởng baseline mới. Archetype dùng margin 10 và cooldown 7 ngày; confidence threshold riêng còn pending.

Mapping trên là rule version `behavior-1`, cần hiệu chỉnh theo phản hồi thực tế và tăng version khi đổi rule. Các event BrewSession, recipe completed, repeat purchase và subscription cycle chưa nối trong phiên bản này.

Quiz luôn là baseline. Behavior chỉ có thể chiếm tối đa 40% ảnh hưởng.

Theo từng trục:

```text
behaviorShare =
  0.40 × min(axisEvidence / evidenceTarget, 1)
```

Đề xuất ban đầu:

```text
evidenceTarget = 50
```

Radar hiện tại:

```text
currentAxis =
  quizAxis × (1 - behaviorShare)
  + behaviorAverage × behaviorShare
```

Ví dụ một order delivered tạo 6 evidence:

```text
behaviorShare = 0.40 × 6/50
              = 0.048
              = 4.8%
```

Quiz vẫn chi phối 95.2% ở thời điểm đó.

Khi evidence đạt 50:

```text
Quiz influence     = 60%
Behavior influence = 40%
```

### 12.1 Missing axis signal

Nếu event không có signal cho một trục:

- Không tạo evidence cho trục đó.
- Không đưa trục về 0.
- Không dùng giá trị trung bình giả.
- Giữ trục theo baseline và các evidence hợp lệ trước đó.

Ví dụ order coffee có taste metadata nhưng không có Tempo:

- Brightness/Boldness/Sweetness có thể cập nhật.
- Skill và Tempo giữ nguyên.

---

## 13. Cập nhật radar và archetype

### 13.1 Radar

Radar được tính lại sau mỗi qualified event:

- Quiz submit hoặc retake.
- Save product/recipe hợp lệ.
- Order delivered.
- Recipe completed.
- BrewSession completed.
- Repeat purchase/subscription delivered.

Radar có thể thay đổi dù archetype chưa thay đổi.

### 13.2 Archetype stability

Đề xuất chỉ đổi archetype khi:

1. Candidate mới gần user hơn archetype hiện tại ít nhất 10 distance points.
2. Confidence đạt ngưỡng tối thiểu.
3. Không có lần đổi archetype nào trong 7 ngày gần nhất.

### 13.3 Rolling cooldown

Rule “không đổi quá một lần trong 7 ngày” là rolling cooldown, không phải batch job mỗi tuần.

Ví dụ:

```text
Thứ Hai:
Archetype đổi → bắt đầu cooldown 7 ngày

Thứ Ba đến Chủ nhật:
Radar vẫn cập nhật
Candidate vẫn được tính
Archetype public chưa đổi tiếp

Sau khi đủ 7 ngày:
Qualified event tiếp theo kích hoạt đánh giá lại
```

Không bắt buộc cron phải đổi archetype đúng ngày thứ bảy.

### 13.4 Retake

- Retake tạo quiz baseline mới.
- Retake có thể bỏ qua cooldown hiện tại và đổi archetype ngay.
- Sau khi retake làm archetype đổi, bắt đầu cooldown 7 ngày mới.

---

## 14. Confidence

Confidence thể hiện hệ thống có bao nhiêu bằng chứng để mô tả user.

Một công thức cần được chốt trước backend. Hướng đề xuất:

```text
quizCompleteness = answeredRequiredQuestions / requiredQuestions
behaviorConfidence = min(totalQualifiedEvidence / evidenceTarget, 1)

confidence =
  0.5 × quizCompleteness
  + 0.5 × behaviorConfidence
```

Confidence thấp:

- Không dùng ngôn ngữ khẳng định quá mạnh.
- AI có thể hỏi lại hoặc đề nghị retake.
- Không đổi archetype chỉ dựa trên signal yếu.

Confidence không phải radar score và không hiển thị như một trục.

---

## 15. Recommendation rules

Recommendation nên xử lý theo thứ tự:

1. Tạo candidate từ sản phẩm active và còn hàng.
2. Lọc các constraint kỹ thuật bắt buộc.
3. Tính độ phù hợp với năm trục.
4. Dùng thuộc tính phụ để điều chỉnh thứ tự.
5. Dùng price preference như soft signal.
6. Bảo đảm diversity.
7. Có fallback cho user chưa có DNA.
8. AI chỉ được re-rank candidate hợp lệ, không tự bịa product ID.

Ví dụ:

```text
Archetype: Zen Purist
Drink lean: nghiêng coffee
Equipment: none
Serving: iced
```

Không nên chỉ đề xuất chasen/ceremonial matcha vì archetype. Hệ thống cần ưu tiên coffee profile phù hợp, recipe iced và dụng cụ không vượt quá equipment level.

---

## 16. AI rules

AI được phép:

- Diễn giải radar bằng ngôn ngữ tự nhiên.
- Tạo summary/vibe theo dữ liệu đã tính.
- Giải thích hai đến ba signal chính.
- Re-rank danh sách candidate do backend cung cấp.
- Gợi ý recipe/product dựa trên profile có cấu trúc.

AI không được phép:

- Tự chấm quiz.
- Tự sửa radar.
- Tự đổi archetype.
- Đọc dữ liệu nhạy cảm không cần thiết.
- Dùng nội dung chat làm behavioral evidence mà user không xác nhận.
- Trả product ID không nằm trong candidate list.

Nếu AI timeout hoặc lỗi, deterministic result và rule-based recommendation vẫn phải hoạt động.

---

## 17. Audit và idempotency

Mọi evolution event cần lưu tối thiểu:

```ts
{
  eventId: string,
  eventType: string,
  sourceId: string,
  sourceVersion: string,
  evidenceWeight: number,
  affectedAxes: string[],
  targetProfile: object,
  radarBefore: object,
  radarAfter: object,
  archetypeBefore: string,
  archetypeAfter: string,
  occurredAt: Date,
  appliedAt: Date,
  reversedAt: Date | null
}
```

Yêu cầu:

- Một source event không được apply hai lần.
- Rule/config phải có version.
- Có thể giải thích vì sao radar thay đổi.
- Có thể reverse khi order refund hoặc dữ liệu bị vô hiệu hóa.

---

## 18. Các điểm còn cần confirm

- [x] Dùng năm trục: Brightness, Boldness, Sweetness, Skill, Tempo.
- [x] Tempo cao nghĩa là nhanh gọn.
- [x] Budget không nằm trong quiz và không hard-filter recommendation.
- [x] Save product/recipe có tác động nhẹ.
- [x] Search/view/like không tác động DNA.
- [x] Behavior không vượt quá 40% radar theo hướng đề xuất hiện tại.
- [x] Archetype dùng rolling cooldown, radar vẫn cập nhật trong cooldown.
- [x] Archetype thứ tư: `Cozy Ritualist`.
- [x] Chốt vector quiz v1 của bốn archetype; hiệu chỉnh tiếp theo dữ liệu sử dụng thật.
- [x] D4/D7 cho chọn 1–2 đáp án, tính điểm trung bình; các câu còn lại single-select.
- [x] Chốt score matrix quiz v1 và kiểm tra bốn bộ trả lời đại diện.
- [x] Khi hai archetype bằng distance, chọn `archetype_id` nhỏ hơn theo thứ tự chữ cái.
- [ ] Chốt threshold `50 evidence` sau khi test dữ liệu mô phỏng.
- [ ] Chốt margin đổi archetype là `10 distance points`.
- [ ] Chốt confidence formula và confidence threshold.
- [ ] Chốt thời gian giữ behavioral events: last 20 events, 90 ngày hoặc kết hợp.
- [ ] Chốt chính xác product/recipe target profiles.

---

## 19. Tóm tắt rule hiện tại

```text
1. Quiz tạo baseline năm trục.

2. Bốn archetype là bốn vector mẫu.

3. Thuộc tính phụ hỗ trợ recommendation,
   không trực tiếp quyết định archetype.

4. Save tạo evidence nhẹ.

5. Purchase tạo evidence trung bình.

6. Actual usage tạo evidence mạnh nhất.

7. Search/view/like không đổi DNA.

8. Evidence không cộng thẳng vào radar.

9. Quiz chiếm tối thiểu 60%; behavior tối đa 40%.

10. Radar cập nhật sau từng qualified event.

11. Archetype chỉ đổi khi candidate tốt hơn đủ margin.

12. Sau khi đổi, archetype cooldown 7 ngày;
    radar vẫn tiếp tục tiến hóa.

13. AI chỉ diễn giải và re-rank,
    không quyết định radar hoặc archetype.
```
