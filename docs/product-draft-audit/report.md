# Rà soát các lần lưu thử sản phẩm

Thời điểm chụp database: 15:00:44 8/11/26 (Việt Nam).

## Kết luận đã xác minh

- Cả 4 sản phẩm dưới đây hiện vẫn Inactive. Không có thao tác bật Active trong lần rà soát này.
- Không có căn cứ gọi cả 4 là bản Save draft. Ba sản phẩm có log đổi trạng thái ngày 06/11; chỉ El Injerto có log sửa nội dung ngày 08/11.
- Log của thao tác sửa cũ chỉ lưu tên, danh mục, trạng thái và giá mặc định; không có bản chụp đầy đủ trước sửa. Vì vậy chưa thể kết luận tất cả các trường khác không thay đổi.

## 1. Bốn sản phẩm Inactive

| ID | Sản phẩm | Thao tác cuối có log | Thời điểm Việt Nam | Điều xác minh được |
| --- | --- | --- | --- | --- |
| 11010 | El Injerto Bourbon, Guatemala | product.update | 12:59:11 8/11/26 | Active → Inactive; tên, danh mục và giá mặc định 25 → 25 trong log. |
| 10021 | Matcha Sonogi | product.status | 14:24:04 6/11/26 | Active → Inactive qua API đổi trạng thái; không thấy log sửa toàn bộ nội dung cho sản phẩm này. |
| 10018 | Craft Matcha | product.status | 14:23:58 6/11/26 | Active → Inactive qua API đổi trạng thái; không thấy log sửa toàn bộ nội dung cho sản phẩm này. |
| 10019 | Yumiko | product.status | 14:23:47 6/11/26 | Active → Inactive qua API đổi trạng thái; không thấy log sửa toàn bộ nội dung cho sản phẩm này. |

## 2. El Injerto Bourbon, Guatemala (11010)

Lưu toàn bộ sản phẩm lúc **12:59:11 ngày 08/11/2026**. Đây là thao tác có thể ghi các nội dung thử nghiệm vào Products theo code cũ.

| Trường | Trước | Hiện tại | Nguồn và giới hạn |
| --- | --- | --- | --- |
| is_active | true | false | Xác nhận bằng old_value/new_value trong activity log. |
| name | El Injerto Bourbon, Guatemala | El Injerto Bourbon, Guatemala | Không đổi trong activity log. |
| category | coffee | coffee | Không đổi trong activity log. |
| Giá variant mặc định | 25 | 25 | Không đổi trong activity log. |
| Ảnh chung product.images | 1 URL | 2 URL | Đối chiếu báo cáo ảnh lúc 12:50 với database hiện tại. |
| Gallery gộp ảnh chung và ảnh variant | 2 URL duy nhất | 2 URL duy nhất | Cùng tập URL, không phát hiện thêm ảnh lạ hay mất ảnh so với mốc 12:50. |
| coffee.roast_level | medium roast | Medium | Đối chiếu kết quả đọc database trước lần lưu trong cuộc hội thoại với snapshot hiện tại; khớp việc form chuẩn hóa tên mức rang, cùng nghĩa Medium. |

Ảnh tăng thêm trong mảng ảnh chung vốn đã có ở variant COF024 trước đó, đúng với việc form gộp gallery ảnh variant vào ảnh sản phẩm:

- [Ảnh được thêm vào product.images](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859443/o3ufw6sgfpg0rrmhvuyx.png>)

### Dữ liệu hiện tại để kiểm tra

| SKU | Label | Giá | Tồn kho | Low-stock threshold |
| --- | --- | ---: | ---: | ---: |
| COF023 | 11 oz | 25 | 16 | 10 |
| COF024 | 5 lb | 160 | 46 | 10 |

- Mô tả hiện tại: For decades, the Aguirre family of Finca El Injerto have pushed the boundaries of quality, innovation, and sustainable farming practices in the coffee world.
- SEO title hiện tại: El Injerto Bourbon, Guatemala | Coffee | Offsite
- Tags hiện tại: coffee, medium-roast, washed, guatemala
- Origin: Huehuetenango, Guatemala. Process: washed.
- Tasting notes: milk chocolate, orange, caramel.
- Best seller: true; New arrival: false; Subscribe discount: 11%.

**Chưa đủ dữ liệu trước sửa để khẳng định**: mô tả, SEO, slug, tags, giá SKU không mặc định, tồn kho, alt text, các cờ cấu hình, hạn dùng và ngưỡng low-stock có bị sửa thử hay không. Giá/tồn kho hiện tại ở bảng trên không được gọi là dữ liệu ban đầu.

## 3. Các thao tác sản phẩm khác tìm được

| Thời điểm Việt Nam | ID | Thao tác | Trước | Sau |
| --- | --- | --- | --- | --- |
| 11:54:42 4/11/26 | 13003 | product.status | {"is_active":true} | {"is_active":false} |
| 11:54:52 4/11/26 | 13003 | product.status | {"is_active":false} | {"is_active":true} |
| 14:23:47 6/11/26 | 10019 | product.status | {"is_active":true} | {"is_active":false} |
| 14:23:58 6/11/26 | 10018 | product.status | {"is_active":true} | {"is_active":false} |
| 14:24:04 6/11/26 | 10021 | product.status | {"is_active":true} | {"is_active":false} |
| 18:25:31 7/11/26 | 14011 | product.status | {"is_active":true} | {"is_active":false} |
| 18:37:17 7/11/26 | 14011 | product.status | {"is_active":false} | {"is_active":true} |
| 20:53:16 7/11/26 | 13003 | product.status | {"is_active":true} | {"is_active":false} |
| 21:21:46 7/11/26 | 13003 | product.status | {"is_active":false} | {"is_active":true} |
| 11:08:10 8/11/26 | 14003 | product.status | {"is_active":true} | {"is_active":false} |
| 11:08:10 8/11/26 | 14004 | product.status | {"is_active":true} | {"is_active":false} |
| 11:08:28 8/11/26 | 14003 | product.status | {"is_active":false} | {"is_active":true} |
| 11:08:28 8/11/26 | 14004 | product.status | {"is_active":false} | {"is_active":true} |
| 12:59:11 8/11/26 | 11010 | product.update | {"name":"El Injerto Bourbon, Guatemala","category":"coffee","is_active":true,"price":25} | {"name":"El Injerto Bourbon, Guatemala","category":"coffee","is_active":false,"price":25} |

## 4. Giới hạn và hướng khôi phục

- Trong dữ liệu đã đọc có 14 activity log sản phẩm và 0 bản ghi ProductDrafts. Không có log product.create hay product.draft-save tại thời điểm chụp; không thấy bằng chứng đã Publish lại 4 sản phẩm trên.
- Đã tìm trong repository, lịch sử file dữ liệu của Git và các nguồn sản phẩm cục bộ có thể xác định; chưa tìm được export/backup đầy đủ của chính collection Products trước 12:59 ngày 08/11. Những workbook trong Downloads đã kiểm tra không khớp bộ sản phẩm Offsite này nên không dùng làm dữ liệu gốc.
- Cần export JSON/BSON hoặc backup MongoDB của đúng collection Products trước thời điểm trên để so sánh đầy đủ mọi trường và khôi phục chính xác.
- Chưa thực hiện bất kỳ thao tác ghi database, khôi phục, bật Active hoặc Publish nào trong lần rà soát này. Không tự dựng lại dữ liệu gốc từ phỏng đoán.

## Nguồn đã dùng

- `database-snapshot.json` cùng thư mục: snapshot Products và log cũ tại thời điểm đọc, không phải backup trước lần Save draft lỗi.
- `../product-variant-images-audit.md`: báo cáo ảnh tạo lúc 12:50 ngày 08/11/2026, trước lần lưu El Injerto lúc 12:59.
- Kết quả đọc database trước lần lưu trong cuộc hội thoại: roast_level của El Injerto là medium roast.
