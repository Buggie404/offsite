# Rà soát nhãn hiển thị và giá trị lưu của Admin Products

Phạm vi: danh sách Products, Edit/Add Product, hộp thêm batch, service gửi API và bộ dựng payload backend. Không ghi hay chuẩn hoá lại database trong lần rà soát này.

| Control | Nhãn hiển thị | Giá trị thực | Kết quả |
| --- | --- | --- | --- |
| Category | Coffee, Matcha, Drinkware, Sets & bundles, Tools | coffee, matcha, drinkware, sets_bundles, tools | Dùng value/label riêng, không gửi nhãn vào database. |
| Roast level | Light, Medium light, Medium, Medium dark, Dark | light roast, medium light roast, medium roast, medium dark roast, dark roast | Giữ giá trị đầy đủ khi mở/lưu; chỉ hiển thị nhãn gọn. API xử lý client cũ bằng quy ước roast đầy đủ. |
| Variant type | No option, Size, Color, Type, Package | none, size, color, type, package | Đã bỏ fallback tự đổi giá trị lạ thành none. |
| Variant type không hợp lệ | Không có lựa chọn yuki | Chỉ chấp nhận none, size, color, type, package | Theo xác nhận của người dùng, yuki là dữ liệu sai. Đã sửa sản phẩm 10020 về none; form/API/model chặn lưu lại yuki. |
| Batch SKU | Mã SKU | Chính mã SKU được chọn | Không thay bằng label/tên sản phẩm. API kiểm tra SKU thuộc sản phẩm. |
| Filter Category | Tên danh mục | Mã danh mục nội bộ | Chỉ lọc trên UI, không ghi database. |
| Filter Status | Active, Inactive | active, inactive | Chỉ lọc trạng thái bán trong Products. Drafts là một mục riêng cạnh Out of stock, không phải trạng thái inactive. |

## Dropdown thuộc tính theo category

Đã đọc lại các giá trị thuộc tính của 92 sản phẩm từ database, rồi đổi 8 trường từ input sang select: Product grade, Pricing tier, Process, Ware type, Material, Set type, Tool category, Tool type. Cấu hình value/label nằm trong `product-attribute-options.ts`.

- Ví dụ: Ceremonial grade giữ value `ceremonial grade`; Ritual series giữ value `ritual_series`; Tea tools giữ value `tea tools`.
- Đã bỏ lựa chọn Not set theo yêu cầu. Field chưa được gán để trống, không tự chọn lựa chọn đầu tiên. Khi không thao tác, field null/rỗng vẫn được giữ nguyên trong form gửi đi.
- Giá trị hiện có ngoài danh sách được đưa vào dropdown bằng đúng giá trị hiện có, không thay bằng mặc định.
- Product grade bao gồm các lựa chọn của bộ lọc Shop: ceremonial grade, premium grade, barista grade, latte grade, related tea.
- Origin và Product size là chuỗi mô tả thay đổi theo sản phẩm, không có enum cố định trong model, nên giữ ô nhập tự do.
- Lần bổ sung dropdown này không cập nhật bất kỳ dữ liệu sản phẩm nào trong database.

## Những lỗi khác tìm thấy và đã sửa trong phạm vi

- Snapshot trước sửa có 7 sản phẩm variant_type=package và Yuki variant_type=yuki. Code cũ đổi các giá trị không nhận diện được sang none khi đưa vào form. Đã bỏ fallback đó, bổ sung package. Sau khi người dùng xác nhận yuki là sai, đã sửa riêng sản phẩm 10020 từ yuki về none trong database; không thay đổi 7 sản phẩm package.
- CSV trước đây xuất trạng thái Inactive thành chữ draft. Đã sửa thành inactive; việc có bản nháp là thông tin độc lập với trạng thái bán.
- Composition có thể chứa cả chuỗi và object. Code cũ có thể parse một chuỗi nhìn giống JSON thành object dù admin chưa sửa. Đã chỉ parse khi nội dung text thực sự thay đổi; áp dụng cùng nguyên tắc giữ nguyên dữ liệu chưa chỉnh cho tags và tasting notes ở bước chuyển form sang payload.
- Label trống của variant vẫn là chuỗi trống; chữ Default là placeholder, không được tự ghi thành label trong dữ liệu.
- Variant chưa gắn ảnh vẫn chưa gắn ảnh; chỉ thao tác chọn ảnh rõ ràng từ Images mới thay đổi ảnh variant.

## Quy tắc kiểm tra

1. Mở sản phẩm và lưu nháp không được tự thay category, variant_type, roast_level, SKU hoặc label bằng nhãn UI.
2. Admin đổi lựa chọn thì payload gửi giá trị của lựa chọn mới theo quy ước database.
3. Giá trị legacy phải được giữ nguyên hoặc có lỗi rõ ràng, không lặng lẽ đổi thành lựa chọn mặc định.
4. Việc sửa yuki về none được người dùng yêu cầu riêng; đã lưu bằng chứng trước/sau trong thư mục product-draft-audit. Không tự Publish, bật Active, gắn ảnh variant hoặc thay đổi các trường khác.
