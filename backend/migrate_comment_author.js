/**
 * Script migrate: backfill author.username / user_id cho các COMMENT cũ
 * đang bị rỗng (do seed data thiếu user_id, giống trường hợp Post trước đó).
 *
 * CÁCH DÙNG:
 * 1. Đặt file này ở thư mục gốc backend (cùng cấp với .env, ví dụ D:\uel\WEB\offsite\backend)
 * 2. Chạy: node migrate_comment_author.js
 *
 * Lưu ý: is_post_author luôn được set về false cho các comment backfill này,
 * vì việc gán user là ngẫu nhiên nên không thể xác định đúng ai là tác giả gốc.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Comment = require('./src/models/Comment');
const User = require('./src/models/User');

async function migrate() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('❌ Không tìm thấy MONGODB_URI trong file .env');
    process.exit(1);
  }

  console.log('🔌 Đang kết nối MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Đã kết nối MongoDB');

  // Tìm các comment có author.username rỗng hoặc không tồn tại
  const brokenComments = await Comment.find({
    $or: [
      { 'author.username': '' },
      { 'author.username': { $exists: false } },
      { 'author.username': null }
    ]
  });

  console.log(`🔎 Tìm thấy ${brokenComments.length} comment bị rỗng tên author.\n`);

  if (brokenComments.length === 0) {
    await mongoose.disconnect();
    console.log('🔌 Không có gì để cập nhật. Hoàn tất!');
    return;
  }

  // Chỉ lấy các user có community_name hợp lệ
  const allUsers = await User.find({
    community_name: { $exists: true, $ne: '' }
  });

  if (allUsers.length === 0) {
    console.error('❌ Không có user nào có community_name hợp lệ trong DB. Dừng lại.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`👥 Tìm thấy ${allUsers.length} user có community_name hợp lệ để gán.\n`);

  // Xáo trộn danh sách user (Fisher-Yates shuffle) để gán không lặp lại
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let shuffledUsers = shuffle(allUsers);
  let pointer = 0;

  let updatedCount = 0;

  for (const comment of brokenComments) {
    if (pointer >= shuffledUsers.length) {
      shuffledUsers = shuffle(allUsers);
      pointer = 0;
    }

    const randomUser = shuffledUsers[pointer];
    pointer++;

    const newUsername = randomUser.community_name;
    const newAvatar = randomUser.avatar_url || '';

    await Comment.updateOne(
      { _id: comment._id },
      {
        $set: {
          user_id: randomUser.user_id,
          'author.username': newUsername,
          'author.avatar_url': newAvatar,
          'author.is_post_author': false // không thể xác định đúng tác giả gốc nên luôn để false
        }
      }
    );

    console.log(`✅ Đã gán comment ${comment.comment_id} → user_id: "${randomUser.user_id}", username: "${newUsername}"`);
    updatedCount++;
  }

  console.log('\n──────── KẾT QUẢ ────────');
  console.log(`Tổng comment bị rỗng:   ${brokenComments.length}`);
  console.log(`Đã gán user thành công: ${updatedCount}`);
  console.log('──────────────────────────\n');

  await mongoose.disconnect();
  console.log('🔌 Đã ngắt kết nối MongoDB. Hoàn tất!');
}

migrate().catch(err => {
  console.error('❌ Lỗi khi chạy migrate:', err);
  process.exit(1);
});