/**
 * Script migrate: backfill author.username / author.avatar_url cho các post cũ
 * đang bị rỗng (do post được tạo trước khi user tương ứng tồn tại trong DB).
 *
 * Script này an toàn để chạy nhiều lần (chỉ update các post đang rỗng tên).
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Post = require('./src/models/Post');
const User = require('./src/models/User');

const POST_IDS_TO_RESET = [
  'POST600001','POST600002','POST600003','POST600004','POST600005',
  'POST600006','POST600007','POST600008','POST600009','POST600010',
  'POST600011','POST600012','POST600013','POST600014','POST600015',
  'POST600016','POST600017','POST600018','POST600019','POST600020',
  'POST600021','POST600022','POST600023','POST600024','POST600025',
  'POST600026','POST600027','POST600028','POST600029','POST600030',
  'POST600031','POST600032','POST600033','POST600034','POST600035',
  'POST600036','POST600037','POST600038','POST600039','POST600040',
  'POST600041','POST600042','POST600043','POST600044','POST600045',
  'POST600046','POST600047','POST600048','POST600049','POST600050'
];

async function migrate() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('❌ Không tìm thấy MONGODB_URI trong file .env');
    process.exit(1);
  }

  console.log('🔌 Đang kết nối MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Đã kết nối MongoDB');

  // Bước 0: Reset lại author.username / user_id về rỗng 
  if (POST_IDS_TO_RESET.length > 0) {
    const resetResult = await Post.updateMany(
      { post_id: { $in: POST_IDS_TO_RESET } },
      {
        $set: {
          user_id: '',
          'author.username': '',
          'author.avatar_url': null
        }
      }
    );
    console.log(`♻️  Đã reset ${resetResult.modifiedCount} post về rỗng để gán lại.\n`);
  }

  // Tìm các post có author.username rỗng hoặc không tồn tại
  const brokenPosts = await Post.find({
    $or: [
      { 'author.username': '' },
      { 'author.username': { $exists: false } },
      { 'author.username': null }
    ]
  });

  console.log(`🔎 Tìm thấy ${brokenPosts.length} post bị rỗng tên author.\n`);

  // Chỉ lấy các user có community_name hợp lệ (bỏ qua user chỉ có profile_name)
  const allUsers = await User.find({
    community_name: { $exists: true, $ne: '' }
  });

  if (allUsers.length === 0) {
    console.error('❌ Không có user nào có community_name hợp lệ trong DB. Dừng lại.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`👥 Tìm thấy ${allUsers.length} user có community_name hợp lệ để gán.\n`);

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

  for (const post of brokenPosts) {
    // Nếu đã dùng hết danh sách, xáo trộn lại và bắt đầu vòng mới
    if (pointer >= shuffledUsers.length) {
      shuffledUsers = shuffle(allUsers);
      pointer = 0;
    }

    const randomUser = shuffledUsers[pointer];
    pointer++;

    const newUsername = randomUser.community_name;
    const newAvatar = randomUser.avatar_url || null;

    await Post.updateOne(
      { _id: post._id },
      {
        $set: {
          user_id: randomUser.user_id,
          'author.username': newUsername,
          'author.avatar_url': newAvatar
        }
      }
    );

    console.log(` Đã gán post ${post.post_id} → user_id: "${randomUser.user_id}", username: "${newUsername}"`);
    updatedCount++;
  }

  console.log('\n──────── KẾT QUẢ ────────');
  console.log(`Tổng post bị rỗng:      ${brokenPosts.length}`);
  console.log(`Đã gán user thành công: ${updatedCount}`);
  console.log('──────────────────────────\n');

  await mongoose.disconnect();
  console.log('🔌 Đã ngắt kết nối MongoDB. Hoàn tất!');
}

migrate().catch(err => {
  console.error('❌ Lỗi khi chạy migrate:', err);
  process.exit(1);
});