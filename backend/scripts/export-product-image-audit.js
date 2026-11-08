// Read-only MongoDB audit. Writes a local Markdown report, never updates products.
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');

const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const images = values => (values || []).filter(image => typeof image?.url === 'string' && image.url.trim());
const links = values => images(values).map((image, i) => `[Ảnh ${i + 1}](<${image.url.trim()}>)`).join(' · ') || 'Không có';
const hasVariantImages = product => (product.variants || []).some(variant => images(variant.images).length);

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
    const products = await mongoose.connection.db.collection('Products').find({}, { projection: {
      _id: 0, product_id: 1, name: 1, category: 1, variant_type: 1, images: 1,
      'variants.sku': 1, 'variants.label': 1, 'variants.images': 1
    } }).sort({ product_id: 1 }).toArray();
    const withImages = products.filter(hasVariantImages);
    const withoutImages = products.filter(product => !hasVariantImages(product));
    const mixed = withImages.filter(product => product.variants.some(variant => !images(variant.images).length));
    const variants = products.flatMap(product => product.variants || []);
    const timestamp = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'full', timeStyle: 'short' }).format(new Date());
    const lines = [
      '# Kiểm tra ảnh sản phẩm và ảnh theo variant', '',
      `Thời điểm đọc database: ${timestamp} (giờ Việt Nam).`, '',
      'Nguồn: collection `Products`, đọc trực tiếp database; báo cáo không chỉnh sửa dữ liệu.', '',
      '## Tổng hợp', '',
      '| Hạng mục | Số lượng |', '| --- | ---: |',
      `| Tổng sản phẩm | ${products.length} |`,
      `| Sản phẩm có ảnh riêng ở ít nhất một variant | ${withImages.length} |`,
      `| Sản phẩm không có ảnh riêng ở bất kỳ variant nào | ${withoutImages.length} |`,
      `| Sản phẩm có variant có ảnh và variant chưa có ảnh | ${mixed.length} |`,
      `| Tổng variant/SKU | ${variants.length} |`,
      `| Variant có ảnh riêng | ${variants.filter(variant => images(variant.images).length).length} |`,
      `| Variant thiếu mã SKU | ${variants.filter(variant => !variant.sku).length} |`, '',
      '## Cách đọc', '',
      '- **Ảnh chung** nằm trong `product.images`; **ảnh variant** nằm trong `product.variants[].images`.',
      '- “Có ảnh riêng” nghĩa là có URL được gắn trong dữ liệu variant. URL đó vẫn có thể trùng với ảnh chung hoặc ảnh variant khác; không có nghĩa là ảnh độc quyền của một SKU.',
      '- Label “(trống)” là dữ liệu thật đang rỗng. `variant_type: none` nghĩa là không có lựa chọn size/màu; sản phẩm vẫn có SKU bán hàng.',
      '- Gallery Images trong Edit Product hiện gộp ảnh chung và ảnh variant, bỏ URL trùng. Số ảnh gallery dưới đây tính theo URL duy nhất.',
      '- Link ảnh là URL đang lưu trong database; báo cáo chưa kiểm tra khả năng tải từng URL.', '',
      '## 1. Sản phẩm có ảnh theo variant', ''
    ];
    for (const product of withImages) {
      const all = [...images(product.images), ...product.variants.flatMap(variant => images(variant.images))];
      lines.push(`### ${product.product_id} — ${cell(product.name)}`, '',
        `Danh mục: \`${product.category}\` · Variant type: \`${product.variant_type || '(trống)'}\` · Gallery: **${new Set(all.map(image => image.url.trim())).size} ảnh khác URL**.`, '',
        `Ảnh chung (${images(product.images).length}): ${links(product.images)}`, '',
        '| SKU | Label | Số ảnh variant | Link ảnh variant |', '| --- | --- | ---: | --- |');
      for (const variant of product.variants || []) lines.push(`| ${cell(variant.sku || '(thiếu SKU)')} | ${cell(variant.label || '(trống)')} | ${images(variant.images).length} | ${links(variant.images)} |`);
      lines.push('');
    }
    lines.push('## 2. Sản phẩm chưa có ảnh riêng cho variant', '',
      'Các SKU dưới đây chưa được gắn ảnh riêng. Cột ảnh chung cho biết sản phẩm vẫn có ảnh ở cấp sản phẩm hay không.', '',
      '| ID | Sản phẩm | Variant type | SKU — label | Ảnh chung |', '| --- | --- | --- | --- | --- |');
    for (const product of withoutImages) lines.push(`| ${product.product_id} | ${cell(product.name)} | ${cell(product.variant_type || '(trống)')} | ${(product.variants || []).map(variant => `${cell(variant.sku || '(thiếu SKU)')} — ${cell(variant.label || '(trống)')}`).join('<br>')} | ${links(product.images)} |`);
    const unusual = products.filter(product => !['none', 'size', 'color', 'type'].includes(product.variant_type));
    lines.push('', '## 3. Bản ghi cần kiểm tra thêm', '');
    if (unusual.length) for (const product of unusual) lines.push(`- **${product.product_id} — ${cell(product.name)}**: \`variant_type = ${product.variant_type}\`, nằm ngoài các giá trị form hỗ trợ (none, size, color, type). Cần kiểm tra lại cấu hình nghiệp vụ; báo cáo không tự sửa database.`);
    else lines.push('Không phát hiện variant type nằm ngoài các giá trị form hỗ trợ.');
    const output = path.resolve(__dirname, '../../docs/product-variant-images-audit.md');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, lines.join('\n') + '\n', 'utf8');
    console.log(JSON.stringify({ output, products: products.length, withVariantImages: withImages.length, withoutVariantImages: withoutImages.length }));
  } catch (error) {
    console.error(error.name + ': ' + error.message.replace(/mongodb[^\s]*/g, '[connection]'));
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})();
