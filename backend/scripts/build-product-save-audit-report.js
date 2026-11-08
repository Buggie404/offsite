const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../docs/product-draft-audit');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'database-snapshot.json'), 'utf8'));
const imageAudit = fs.readFileSync(path.resolve(root, '../product-variant-images-audit.md'), 'utf8');
const target = snapshot.products.find(product => product.product_id === 11010);
const section = imageAudit.split('### 11010 — ')[1].split('\n### ')[0];
const originalCommon = [...section.split('Ảnh chung (1): ')[1].split('\n')[0].matchAll(/\(<([^>]+)>\)/g)].map(match => match[1]);
const originalGallery = [...new Set([...section.matchAll(/\(<([^>]+)>\)/g)].map(match => match[1]))];
const currentCommon = target.images.map(image => image.url);
const currentGallery = [...new Set([...currentCommon, ...target.variants.flatMap(variant => variant.images.map(image => image.url))])];
const added = currentCommon.filter(url => !originalCommon.includes(url));
const changedGallery = originalGallery.length !== currentGallery.length || originalGallery.some(url => !currentGallery.includes(url));
const vn = date => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(date));
const lines = [
  '# Rà soát các lần lưu thử sản phẩm', '',
  `Thời điểm chụp database: ${vn(snapshot.read_at)} (Việt Nam).`, '',
  '## Kết luận đã xác minh', '',
  '- Cả 4 sản phẩm dưới đây hiện vẫn Inactive. Không có thao tác bật Active trong lần rà soát này.',
  '- Không có căn cứ gọi cả 4 là bản Save draft. Ba sản phẩm có log đổi trạng thái ngày 06/11; chỉ El Injerto có log sửa nội dung ngày 08/11.',
  '- Log của thao tác sửa cũ chỉ lưu tên, danh mục, trạng thái và giá mặc định; không có bản chụp đầy đủ trước sửa. Vì vậy chưa thể kết luận tất cả các trường khác không thay đổi.', '',
  '## 1. Bốn sản phẩm Inactive', '',
  '| ID | Sản phẩm | Thao tác cuối có log | Thời điểm Việt Nam | Điều xác minh được |',
  '| --- | --- | --- | --- | --- |'
];
for (const id of [11010, 10021, 10018, 10019]) {
  const product = snapshot.products.find(p => p.product_id === id);
  const logs = snapshot.logs.filter(log => log.target_id === String(id));
  const last = logs[logs.length - 1];
  lines.push(`| ${id} | ${product.name} | ${last?.action_type || 'Không có log'} | ${last ? vn(last.created_at) : 'Không rõ'} | ${id === 11010 ? 'Active → Inactive; tên, danh mục và giá mặc định 25 → 25 trong log.' : 'Active → Inactive qua API đổi trạng thái; không thấy log sửa toàn bộ nội dung cho sản phẩm này.'} |`);
}
lines.push('', '## 2. El Injerto Bourbon, Guatemala (11010)', '',
  'Lưu toàn bộ sản phẩm lúc **12:59:11 ngày 08/11/2026**. Đây là thao tác có thể ghi các nội dung thử nghiệm vào Products theo code cũ.', '',
  '| Trường | Trước | Hiện tại | Nguồn và giới hạn |', '| --- | --- | --- | --- |',
  '| is_active | true | false | Xác nhận bằng old_value/new_value trong activity log. |',
  '| name | El Injerto Bourbon, Guatemala | El Injerto Bourbon, Guatemala | Không đổi trong activity log. |',
  '| category | coffee | coffee | Không đổi trong activity log. |',
  '| Giá variant mặc định | 25 | 25 | Không đổi trong activity log. |',
  '| Ảnh chung product.images | 1 URL | 2 URL | Đối chiếu báo cáo ảnh lúc 12:50 với database hiện tại. |',
  `| Gallery gộp ảnh chung và ảnh variant | ${originalGallery.length} URL duy nhất | ${currentGallery.length} URL duy nhất | ${changedGallery ? 'Có khác biệt URL.' : 'Cùng tập URL, không phát hiện thêm ảnh lạ hay mất ảnh so với mốc 12:50.'} |`,
  '| coffee.roast_level | medium roast | Medium | Đối chiếu kết quả đọc database trước lần lưu trong cuộc hội thoại với snapshot hiện tại; khớp việc form chuẩn hóa tên mức rang, cùng nghĩa Medium. |', '',
  'Ảnh tăng thêm trong mảng ảnh chung vốn đã có ở variant COF024 trước đó, đúng với việc form gộp gallery ảnh variant vào ảnh sản phẩm:', '',
  ...added.map(url => `- [Ảnh được thêm vào product.images](<${url}>)`), '',
  '### Dữ liệu hiện tại để kiểm tra', '',
  '| SKU | Label | Giá | Tồn kho | Low-stock threshold |', '| --- | --- | ---: | ---: | ---: |',
  ...target.variants.map(variant => `| ${variant.sku} | ${variant.label} | ${variant.price} | ${variant.stock} | ${variant.low_stock_threshold ?? '(chưa lưu)'} |`), '',
  `- Mô tả hiện tại: ${target.description}`,
  `- SEO title hiện tại: ${target.seo_title}`,
  `- Tags hiện tại: ${target.product_tag.join(', ')}`,
  `- Origin: ${target.coffee.product_origin}. Process: ${target.coffee.process_type}.`,
  `- Tasting notes: ${target.coffee.tasting_notes.join(', ')}.`,
  `- Best seller: ${target.is_best_seller}; New arrival: ${target.is_new_arrival}; Subscribe discount: ${target.subscribe_discount_percent}%.`, '',
  '**Chưa đủ dữ liệu trước sửa để khẳng định**: mô tả, SEO, slug, tags, giá SKU không mặc định, tồn kho, alt text, các cờ cấu hình, hạn dùng và ngưỡng low-stock có bị sửa thử hay không. Giá/tồn kho hiện tại ở bảng trên không được gọi là dữ liệu ban đầu.', '',
  '## 3. Các thao tác sản phẩm khác tìm được', '',
  '| Thời điểm Việt Nam | ID | Thao tác | Trước | Sau |', '| --- | --- | --- | --- | --- |',
  ...snapshot.logs.map(log => `| ${vn(log.created_at)} | ${log.target_id} | ${log.action_type} | ${JSON.stringify(log.old_value)} | ${JSON.stringify(log.new_value)} |`), '',
  '## 4. Giới hạn và hướng khôi phục', '',
  '- Trong dữ liệu đã đọc có 14 activity log sản phẩm và 0 bản ghi ProductDrafts. Không có log product.create hay product.draft-save tại thời điểm chụp; không thấy bằng chứng đã Publish lại 4 sản phẩm trên.',
  '- Đã tìm trong repository, lịch sử file dữ liệu của Git và các nguồn sản phẩm cục bộ có thể xác định; chưa tìm được export/backup đầy đủ của chính collection Products trước 12:59 ngày 08/11. Những workbook trong Downloads đã kiểm tra không khớp bộ sản phẩm Offsite này nên không dùng làm dữ liệu gốc.',
  '- Cần export JSON/BSON hoặc backup MongoDB của đúng collection Products trước thời điểm trên để so sánh đầy đủ mọi trường và khôi phục chính xác.',
  '- Chưa thực hiện bất kỳ thao tác ghi database, khôi phục, bật Active hoặc Publish nào trong lần rà soát này. Không tự dựng lại dữ liệu gốc từ phỏng đoán.', '',
  '## Nguồn đã dùng', '',
  '- `database-snapshot.json` cùng thư mục: snapshot Products và log cũ tại thời điểm đọc, không phải backup trước lần Save draft lỗi.',
  '- `../product-variant-images-audit.md`: báo cáo ảnh tạo lúc 12:50 ngày 08/11/2026, trước lần lưu El Injerto lúc 12:59.',
  '- Kết quả đọc database trước lần lưu trong cuộc hội thoại: roast_level của El Injerto là medium roast.', ''
);
fs.writeFileSync(path.join(root, 'report.md'), lines.join('\n'), 'utf8');
console.log(JSON.stringify({ report: path.join(root, 'report.md'), commonImageCountBefore: originalCommon.length,
  commonImageCountNow: currentCommon.length, uniqueGalleryChanged: changedGallery, productLogs: snapshot.logs.length }));
