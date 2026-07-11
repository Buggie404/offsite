const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getCollections } = require('../config/db');
const ACCESS_SECRET   = process.env.JWT_SECRET         || 'fallback-secret-key';
const REFRESH_SECRET  = process.env.JWT_REFRESH_SECRET  || 'refresh_secret_dev';
const { ObjectId } = require('mongodb');
const { mergeGuestCartIntoUser } = require('../services/cart-merge.service');

// Chuẩn hóa
function normalizeIdentity(value, isEmail = false) {
  if (!value) return null;
  let v = String(value).trim();
  if (!isEmail) {
    v = v.replace(/\s+/g, '');
  } else {
    v = v.toLowerCase();
  }
  return v;
}

function findUser(userCollection, email, phone) {
  const query = {
    $or: [
      email ? { email } : null,
      phone ? { phone } : null
    ].filter(Boolean)
  };
  return userCollection.findOne(query);
}

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const OTP_EXPIRE_MS = 2 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;

// Che email: giữ ký tự đầu/cuối phần trước @, phần còn lại thay bằng dấu chấm
function maskEmail(email) {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);

  if (local.length <= 2) {
    return `${local[0]}${'*'.repeat(Math.max(local.length - 1, 1))}${domain}`;
  }

  const first = local[0];
  const last = local[local.length - 1];
  const dots = '.'.repeat(Math.min(Math.max(local.length - 2, 3), 8));
  return `${first}${dots}${last}${domain}`;
}

// Che số điện thoại theo định dạng quốc tế VN: +84 xxx xxx x71 (chỉ hiện 2 số cuối)
function maskPhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  const local = digits.replace(/^0+/, ''); // bỏ số 0 đầu để ghép với mã quốc gia +84
  const lastTwo = local.slice(-2);
  const maskedDigits = 'x'.repeat(Math.max(local.length - 2, 0)) + lastTwo;

  // Chia nhóm 3 số cho dễ đọc: xxx xxx x71
  const groups = [];
  for (let i = 0; i < maskedDigits.length; i += 3) {
    groups.push(maskedDigits.slice(i, i + 3));
  }

  return `+84 ${groups.join(' ')}`;
}

// Sinh community_name tự động từ tên hiển thị, đảm bảo không trùng
async function generateCommunityName(userCollection, displayName) {
  const base = String(displayName || 'user')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 15) || 'user';

  let candidate = base;
  let attempt = 0;

  // Thử tối đa vài lần, nếu trùng thì thêm số ngẫu nhiên vào cuối
  while (await userCollection.findOne({ community_name: candidate })) {
    attempt++;
    const suffix = Math.floor(1000 + Math.random() * 9000);
    candidate = `${base}${suffix}`;
    if (attempt > 10) {
      candidate = `${base}${Date.now()}`;
      break;
    }
  }

  return candidate;
}

// Đăng ký tài khoản mới (Register)
async function register(req, res) {
  try {
    const { email, phone, password, name, profile_name } = req.body;
    const displayName = profile_name || name;
   
    // phải có password + displayName + ít nhất email OR phone
    if (!password || !displayName || (!email && !phone)) {
      return res.status(400).json({
        error: 'Phải có password + tên + email hoặc số điện thoại'
      });
    }

    // Password
    if (!password || password.length < 8 || password.length > 15) {
      return res.status(400).json({
        error: 'Mật khẩu phải từ 8 đến 15 kí tự'
      });
    }

    if (/\s/.test(password)) {
      return res.status(400).json({
        error: 'Mật khẩu không được chứa khoảng trắng'
      });
    }

    const { userCollection, otpCollection } = await getCollections();

    // Check trùng email/phone
    if (email) {
      const emailExists = await userCollection.findOne({ email: email.trim().toLowerCase() });
      if (emailExists) {
        return res.status(409).json({ error: 'This email is already registered.', code: 'EMAIL_EXISTS' });
      }
    }

    if (phone) {
      const phoneExists = await userCollection.findOne({ phone: phone.trim() });
      if (phoneExists) {
        return res.status(409).json({ error: 'This phone number is already registered.', code: 'PHONE_EXISTS' });
      }
    }

    // Xóa yêu cầu đăng ký cũ nếu người dùng đăng ký lại
    await otpCollection.deleteMany({
      $or: [
        email ? { email: email.trim().toLowerCase() } : null,
        phone ? { phone: phone.trim() } : null
      ].filter(Boolean)
    });

    // Tự động hash mật khẩu với saltRounds = 10
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const registration_id = new ObjectId().toString();
    const otp = generateOTP();

    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const normalizedPhone = phone ? phone.trim() : null;

    await otpCollection.insertOne({
      registration_id,
      email: normalizedEmail,
      phone: normalizedPhone,
      password_hash: hashedPassword,
      profile_name: displayName,
      avatar_url: req.body.avatar_url || null,
      otp,
      attempts: 0,
      expiresAt: new Date(Date.now() + OTP_EXPIRE_MS),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log(`[REGISTER OTP] ${email || phone} -> ${otp}`);

    const maskedContact = normalizedEmail ? maskEmail(normalizedEmail) : maskPhone(normalizedPhone);

    res.status(201).json({
      message: 'OTP sent.',
      registration_id,
      maskedContact,
      channel: normalizedEmail ? 'email' : 'phone',
      __mock: process.env.NODE_ENV !== 'production' ? otp : undefined
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Xác thực OTP đăng ký
async function verifyRegistrationOtp(req, res) {
  try {
    const { registration_id, otp } = req.body;

    if (!registration_id || !otp) {
      return res.status(400).json({ error: 'Thiếu registration_id hoặc OTP.', code: 'MISSING_FIELDS' });
    }

    const { userCollection, otpCollection } = await getCollections();
    const pending = await otpCollection.findOne({ registration_id });

    if (!pending) {
      return res.status(404).json({ error: 'Yêu cầu đăng ký không tồn tại.', code: 'REGISTRATION_NOT_FOUND' });
    }

    if (pending.expiresAt < new Date()) {
      await otpCollection.deleteOne({ _id: pending._id });
      return res.status(400).json({ error: 'OTP đã hết hạn.', code: 'OTP_EXPIRED' });
    }

    if ((pending.attempts || 0) >= OTP_MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'Sai quá số lần cho phép. Vui lòng gửi lại mã.', code: 'OTP_LOCKED' });
    }

    if (pending.otp !== otp) {
      const attempts = (pending.attempts || 0) + 1;
      const remaining = OTP_MAX_ATTEMPTS - attempts;

      await otpCollection.updateOne( { _id: pending._id }, { $set: { attempts } });

      if (remaining <= 0) {
        return res.status(400).json({ error: 'Sai quá số lần cho phép. Vui lòng gửi lại mã.', code: 'OTP_LOCKED' });
      }

      return res.status(400).json({ error: `OTP không chính xác. Còn ${remaining} lần thử.`, code: 'INVALID_OTP', remainingAttempts: remaining });
    }

    // Sinh user_id tuần tự
    const lastUser = await userCollection.findOne({}, { sort: { user_id: -1 } });
    let nextNum = 1;
    if (lastUser?.user_id) {
      const match = lastUser.user_id.match(/USR(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    const user_id = `USR${String(nextNum).padStart(5, '0')}`;

    // Sinh community_name
    const community_name = await generateCommunityName(userCollection, pending.profile_name);

    const newUser = {
      user_id,
      password_hash: pending.password_hash,
      oauth_providers: [],
      profile_name: pending.profile_name,
      avatar_url: pending.avatar_url || null,
      community_name,
      role: 'customer',
      status: 'active',
      addresses: [],
      payment_methods: [],
      saved_products: [],
      saved_recipes: [],
      saved_posts: [],
      saved_blogs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (pending.email) newUser.email = pending.email;
    if (pending.phone) newUser.phone = pending.phone;

    const result = await userCollection.insertOne(newUser);
    await otpCollection.deleteOne({ _id: pending._id });

    const token = jwt.sign(
      { user_id: result.insertedId, email: newUser.email || '', role: newUser.role },
      ACCESS_SECRET,
      { expiresIn: '8h' }
    );

    res.status(201).json({
      message: 'Xác thực thành công.',
      token,
      user: {
        _id: result.insertedId,
        user_id: newUser.user_id,
        email: newUser.email || '',
        phone: newUser.phone || '',
        profile_name: newUser.profile_name,
        role: newUser.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Gửi lại OTP đăng ký
async function resendRegistrationOtp(req, res) {
  try {
    const { registration_id } = req.body;
    if (!registration_id) return res.status(400).json({ error: 'Thiếu registration_id.', code: 'MISSING_FIELDS' });

    const { otpCollection } = await getCollections();
    const pending = await otpCollection.findOne({ registration_id });

    if (!pending) {
      return res.status(404).json({ error: 'Yêu cầu đăng ký không tồn tại hoặc đã hết hạn. Vui lòng đăng ký lại.', code: 'REGISTRATION_NOT_FOUND' });
    }

    const otp = generateOTP();
    await otpCollection.updateOne(
      { _id: pending._id },
      {
        $set: {
          otp,
          attempts: 0,
          expiresAt: new Date(Date.now() + OTP_EXPIRE_MS),
          updatedAt: new Date()
        }
      }
    );

    console.log(`[RESEND OTP] registration_id=${registration_id} -> ${otp}`);
    const maskedContact = pending.email ? maskEmail(pending.email) : maskPhone(pending.phone);

    res.status(200).json({
      message: 'A new verification code has been sent.',
      maskedContact,
      __mock: process.env.NODE_ENV !== 'production' ? otp : undefined
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Đăng nhập (Login)
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Vui lòng cung cấp email và password.', code: 'MISSING_FIELDS' });
    }
    let identifier = String(email).trim();
    const isEmail = identifier.includes('@');
    identifier = normalizeIdentity(identifier, isEmail);

    const { userCollection } = await getCollections();
   
    const user = await userCollection.findOne({
      $or: [ { email: identifier }, { phone: identifier } ]
    });   
    if (!user) {
      return res.status(404).json({ error: 'Tài khoản không tồn tại trong hệ thống.', code: 'ACCOUNT_NOT_FOUND' });
    }

    if (!user.password_hash) {
      return res.status(400).json({ error: 'Tài khoản này được đăng ký thông qua mạng xã hội.', code: 'OAUTH_ACCOUNT' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Tài khoản admin không được phép đăng nhập tại đây.', code: 'ADMIN_NOT_ALLOWED' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Mật khẩu không chính xác.', code: 'INCORRECT_PASSWORD' });
    }

    const token = jwt.sign(
      { user_id: user._id, email: user.email || '', role: user.role },
      ACCESS_SECRET,
      { expiresIn: '8h' }
    );

    let mergedCart = null;
    try {
      const guestCart = req.body.guestCart || req.body.guestItems || [];
      mergedCart = await mergeGuestCartIntoUser(user.user_id, guestCart);
    } catch (mergeErr) {
      console.error('Cart merge on login failed:', mergeErr.message);
    }

    res.json({
      message: 'Đăng nhập thành công',
      token,
      cart: mergedCart,
      user: {
        _id: user._id,
        user_id: user.user_id,
        email: user.email || '',
        phone: user.phone || '',
        profile_name: user.profile_name,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Đăng nhập Admin
async function adminLogin(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Vui lòng cung cấp email và password.', code: 'MISSING_FIELDS' });
    }

    const identifier = normalizeIdentity(email, true);
    const { userCollection } = await getCollections();

    const user = await userCollection.findOne({ email: identifier });

    if (!user) {
      return res.status(404).json({ error: 'Tài khoản không tồn tại trong hệ thống.', code: 'ACCOUNT_NOT_FOUND' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Tài khoản này không có quyền truy cập admin.', code: 'NOT_ADMIN' });
    }

    if (!user.password_hash) {
      return res.status(400).json({ error: 'Tài khoản này không hỗ trợ đăng nhập bằng mật khẩu.', code: 'OAUTH_ACCOUNT' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash).catch(() => false);
    if (!isValid) {
      return res.status(401).json({ error: 'Mật khẩu không chính xác.', code: 'INCORRECT_PASSWORD' });
    }

    const token = jwt.sign(
      { user_id: String(user._id), email: user.email || '', role: user.role },
      ACCESS_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Đăng nhập admin thành công',
      token,
      user: {
        _id: user._id,
        user_id: user.user_id,
        email: user.email || '',
        profile_name: user.profile_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Đăng nhập admin thất bại. Vui lòng thử lại.', code: 'SERVER_ERROR' });
  }
}

// Đăng xuất (Logout)
async function logout(req, res) {
  res.json({ message: 'Đăng xuất thành công.' });
}

// Refresh Token placeholder
async function refreshToken(req, res) {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return res.status(400).json({ error: 'Thiếu refreshToken.' });

    let payload;
    try { payload = jwt.verify(token, REFRESH_SECRET); }
    catch { return res.status(401).json({ error: 'refreshToken không hợp lệ hoặc hết hạn.' }); }

    const { userCollection } = await getCollections();
    const user = await userCollection.findOne({ _id: new ObjectId(payload.sub) });
    if (!user) return res.status(404).json({ error: 'Tài khoản không tồn tại.' });

    const accessToken = jwt.sign(
      { user_id: user._id, email: user.email || '', role: user.role },
      ACCESS_SECRET,
      { expiresIn: '8h' }
    );

    const newRefreshToken = jwt.sign(
      { user_id: user._id },
      REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token: accessToken,
      refreshToken: newRefreshToken,
      user: {
        _id: user._id,
        user_id: user.user_id,
        email: user.email || '',
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Lấy thông tin trang cá nhân
async function getProfile(req, res) {
  try {
    const { ObjectId } = require('mongodb');
    const { userCollection } = await getCollections();
    const user = await userCollection.findOne(
      { _id: new ObjectId(req.user.user_id) },
      { projection: { password_hash: 0 } }
    );
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Cập nhật trang cá nhân (Update Profile)
async function updateProfile(req, res) {
  try {
    const { ObjectId } = require('mongodb');
    const { profile_name, email, phone, community_name } = req.body;

    if (!profile_name) {
      return res.status(400).json({ error: 'Name cannot be empty.' });
    }

    const { userCollection } = await getCollections();
    const userId = new ObjectId(req.user.user_id);

    // Kiểm tra trùng email
    if (email) {
      const emailUser = await userCollection.findOne({
        email: email.trim(),
        _id: { $ne: userId }
      });
      if (emailUser) {
        return res.status(409).json({ error: 'This email is already used by another account.' });
      }
    }

    // Kiểm tra trùng số điện thoại
    if (phone) {
      const phoneUser = await userCollection.findOne({
        phone: phone.trim(),
        _id: { $ne: userId }
      });
      if (phoneUser) {
        return res.status(409).json({ error: 'This phone number is already used by another account.' });
      }
    }

    // Kiểm tra trùng community_name
    if (community_name) {
      const communityUser = await userCollection.findOne({
        community_name: community_name.trim(),
        _id: { $ne: userId }
      });
      if (communityUser) {
        return res.status(409).json({ error: 'This community name is already registered.' });
      }
    }

    const updateFields = {
      profile_name: profile_name.trim(),
      updatedAt: new Date()
    };
    if (email) updateFields.email = email.trim();
    if (phone) updateFields.phone = phone.trim();
    if (community_name !== undefined) updateFields.community_name = community_name ? community_name.trim() : null;
    if (req.body.avatar_url !== undefined) updateFields.avatar_url = req.body.avatar_url;

    await userCollection.updateOne(
      { _id: userId },
      { $set: updateFields }
    );

    const updatedUser = await userCollection.findOne(
      { _id: userId },
      { projection: { password_hash: 0 } }
    );

    res.json({
      message: 'Cập nhật thông tin thành công.',
      user: updatedUser
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Đổi mật khẩu
async function changePassword(req, res) {
  try {
    const { ObjectId } = require('mongodb');
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Vui lòng cung cấp mật khẩu cũ và mật khẩu mới.' });
    }

    if (newPassword.length < 8 || newPassword.length > 15 || /\s/.test(newPassword)) {
      return res.status(400).json({ error: 'Mật khẩu phải từ 8 đến 15 kí tự.' });
    }

    const { userCollection } = await getCollections();
    const userId = new ObjectId(req.user.user_id);
    const user = await userCollection.findOne({ _id: userId });

    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }

    if (user.password_hash) {
      const isValid = await bcrypt.compare(oldPassword, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Mật khẩu cũ không chính xác.' });
      }
    } else {
      return res.status(400).json({ error: 'Tài khoản này đăng nhập qua MXH và chưa tạo mật khẩu.' });  
    }

    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    await userCollection.updateOne(
      { _id: userId },
      { $set: { password_hash: hashedNewPassword, updatedAt: new Date() } }
    );

    res.json({ message: 'Đổi mật khẩu thành công.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Forgot + Reset
async function forgotPassword(req, res) {
  try {
    let { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Vui lòng nhập email hoặc số điện thoại.' });
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());
    identifier = normalizeIdentity(identifier, isEmail);

    const { userCollection, otpCollection } = await getCollections();
    const user = await findUser(userCollection, identifier, identifier);

    if (!user) {
      return res.json({ message: 'Nếu tài khoản tồn tại, bạn sẽ nhận được mã OTP.' });
    }

    await otpCollection.deleteMany({ user_id: user._id });

    const otp = generateOTP();
    await otpCollection.insertOne({
      user_id  : user._id,
      otp,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      createdAt: new Date()
    });

    console.log(`\n[MOCK OTP] ${identifier} → ${otp}\n`);

    res.json({
      message : 'Mã OTP đã được gửi.',
      __mock  : process.env.NODE_ENV !== 'production' ? otp : undefined
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function resetPassword(req, res) {
  try {
    let { identifier, otp, newPassword } = req.body;
    if (!identifier || !otp || !newPassword) {
      return res.status(400).json({ error: 'Thiếu identifier, otp hoặc newPassword.' });
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());
    identifier = normalizeIdentity(identifier, isEmail);

    if (newPassword.length < 8 || newPassword.length > 15 || /\s/.test(newPassword)) {
      return res.status(400).json({ error: 'Mật khẩu từ 8 đến 15 kí tự, không chứa khoảng trắng.' });
    }

    const { userCollection, otpCollection } = await getCollections();
    const user = await findUser(userCollection, identifier, identifier);
    if (!user) return res.status(404).json({ error: 'Tài khoản không tồn tại.' });

    const otpRecord = await otpCollection.findOne({ user_id: user._id });
    if (!otpRecord) {
      return res.status(400).json({ error: 'Không tìm thấy yêu cầu đặt lại mật khẩu.' });    
    }

    if (new Date() > new Date(otpRecord.expiresAt)) {
      await otpCollection.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({ error: 'Mã OTP đã hết hạn.' });
    }

    if (otpRecord.otp !== String(otp).trim()) {
      return res.status(400).json({ error: 'Mã OTP không chính xác.' });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await userCollection.updateOne(
      { _id: user._id },
      { $set: { password_hash, updatedAt: new Date() } }
    );
    await otpCollection.deleteOne({ _id: otpRecord._id });

    res.json({ message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function addAddress(req, res) {
  try {
    const { recipient_name, phone, city, detail_address, label, is_default } = req.body;
    if (!recipient_name || !phone || !city || !detail_address) {
      return res.status(400).json({ error: 'Missing required address fields.' });
    }

    const { userCollection } = await getCollections();
    const { ObjectId } = require('mongodb');
    const userId = new ObjectId(req.user.user_id);

    const user = await userCollection.findOne({ _id: userId });
    const currentAddresses = user.addresses || [];

    const shouldBeDefault = currentAddresses.length === 0 ? true : !!is_default;

    const newAddressId = new ObjectId();
    const newAddress = {
      _id: newAddressId,
      recipient_name,
      phone,
      city,
      detail_address,
      label: label || null,
      is_default: shouldBeDefault
    };

    if (shouldBeDefault) {
      await userCollection.updateOne(
        { _id: userId },
        { $set: { "addresses.$[].is_default": false } }
      );
    }

    await userCollection.updateOne(
      { _id: userId },
      { $push: { addresses: newAddress } }
    );

    res.status(201).json({ message: 'Address added successfully', address: newAddress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateAddress(req, res) {
  try {
    const { id } = req.params;
    const { recipient_name, phone, city, detail_address, label, is_default } = req.body;

    const { userCollection } = await getCollections();
    const { ObjectId } = require('mongodb');
    const userId = new ObjectId(req.user.user_id);
    const addressId = new ObjectId(id);

    const user = await userCollection.findOne({ _id: userId });
    const currentAddresses = user.addresses || [];
    const targetAddress = currentAddresses.find(a => a._id.toString() === id);

    if (!targetAddress) {
      return res.status(404).json({ error: 'Address not found' });
    }

    let finalIsDefault = is_default;
    if (currentAddresses.length === 1) {
      finalIsDefault = true;
    } else if (is_default === false && targetAddress.is_default) {
      const otherAddress = currentAddresses.find(a => a._id.toString() !== id);
      if (otherAddress) {
        await userCollection.updateOne(
          { _id: userId, "addresses._id": otherAddress._id },
          { $set: { "addresses.$.is_default": true } }
        );
      }
    } else if (is_default === true) {
      await userCollection.updateOne(
        { _id: userId },
        { $set: { "addresses.$[].is_default": false } }
      );
    }

    const updateFields = {};
    if (recipient_name !== undefined) updateFields["addresses.$.recipient_name"] = recipient_name;
    if (phone !== undefined) updateFields["addresses.$.phone"] = phone;
    if (city !== undefined) updateFields["addresses.$.city"] = city;
    if (detail_address !== undefined) updateFields["addresses.$.detail_address"] = detail_address;
    if (label !== undefined) updateFields["addresses.$.label"] = label;
    if (finalIsDefault !== undefined) updateFields["addresses.$.is_default"] = !!finalIsDefault;

    await userCollection.updateOne(
      { _id: userId, "addresses._id": addressId },
      { $set: updateFields }
    );

    const updatedUser = await userCollection.findOne({ _id: userId });
    const address = updatedUser.addresses.find(a => a._id.toString() === id);

    res.json({ message: 'Address updated successfully', address });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteAddress(req, res) {
  try {
    const { id } = req.params;
    const { userCollection } = await getCollections();
    const { ObjectId } = require('mongodb');
    const userId = new ObjectId(req.user.user_id);
    const addressId = new ObjectId(id);

    await userCollection.updateOne(
      { _id: userId },
      { $pull: { addresses: { _id: addressId } } }
    );

    const updatedUser = await userCollection.findOne({ _id: userId });
    const remaining = updatedUser.addresses || [];

    if (remaining.length > 0) {
      const hasDefault = remaining.some(a => a.is_default);
      if (!hasDefault || remaining.length === 1) {
        await userCollection.updateOne(
          { _id: userId, "addresses._id": remaining[0]._id },
          { $set: { "addresses.$.is_default": true } }
        );
      }
    }

    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function addPaymentMethod(req, res) {
  try {
    const { card_type, card_number, cardholder_name, expire_date, cvc, issued_bank, is_default } = req.body;
    if (!card_type || !card_number || !cardholder_name || !expire_date) {
      return res.status(400).json({ error: 'Missing required card fields.' });
    }

    const { userCollection } = await getCollections();
    const { ObjectId } = require('mongodb');
    const userId = new ObjectId(req.user.user_id);
    const newCardId = new ObjectId();

    const newCard = {
      _id: newCardId,
      card_type,
      card_number,
      cardholder_name,
      expire_date,
      cvc: card_type !== 'NAPAS' ? cvc : null,
      issued_bank: card_type === 'NAPAS' ? issued_bank : null,
      is_default: !!is_default
    };

    if (newCard.is_default) {
      await userCollection.updateOne(
        { _id: userId },
        { $set: { "payment_methods.$[].is_default": false } }
      );
    }

    await userCollection.updateOne(
      { _id: userId },
      { $push: { payment_methods: newCard } }
    );

    res.status(201).json({ message: 'Payment method added successfully', payment_method: newCard });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deletePaymentMethod(req, res) {
  try {
    const { id } = req.params;
    const { userCollection } = await getCollections();
    const { ObjectId } = require('mongodb');
    const userId = new ObjectId(req.user.user_id);
    const cardId = new ObjectId(id);

    await userCollection.updateOne(
      { _id: userId },
      { $pull: { payment_methods: { _id: cardId } } }
    );

    res.json({ message: 'Payment method deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function toggleSavedProduct(req, res) {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'Missing productId' });
    const User = require('../models/User');
    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const prodIdStr = String(productId);
    const index = user.saved_products.findIndex(sp => sp.product_id === prodIdStr);
    let saved = false;
    if (index > -1) {
      user.saved_products.splice(index, 1);
    } else {
      user.saved_products.push({ product_id: prodIdStr, saved_at: new Date() });
      saved = true;
    }
    await user.save();
    res.json({ message: saved ? 'Product saved' : 'Product unsaved', saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function toggleSavedRecipe(req, res) {
  try {
    const { recipeId } = req.body;
    if (!recipeId) return res.status(400).json({ error: 'Missing recipeId' });
    const User = require('../models/User');
    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const recipeIdStr = String(recipeId);
    const index = user.saved_recipes.findIndex(sr => sr.recipe_id === recipeIdStr);
    let saved = false;
    if (index > -1) {
      user.saved_recipes.splice(index, 1);
    } else {
      user.saved_recipes.push({ recipe_id: recipeIdStr, saved_at: new Date() });
      saved = true;
    }
    await user.save();

    const Recipe = require('../models/Recipe');
    await Recipe.updateOne(
      { recipe_id: recipeIdStr },
      { $inc: { saves: saved ? 1 : -1 } }
    );

    res.json({ message: saved ? 'Recipe saved' : 'Recipe unsaved', saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function toggleSavedBlog(req, res) {
  try {
    const { blogId } = req.body;
    if (!blogId) return res.status(400).json({ error: 'Missing blogId' });
    const User = require('../models/User');
    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const blogIdStr = String(blogId);
    const index = user.saved_blogs.findIndex(sb => sb.blog_id === blogIdStr);
    let saved = false;
    if (index > -1) {
      user.saved_blogs.splice(index, 1);
    } else {
      user.saved_blogs.push({ blog_id: blogIdStr, saved_at: new Date() });
      saved = true;
    }
    await user.save();
    res.json({ message: saved ? 'Blog saved' : 'Blog unsaved', saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function toggleSavedPost(req, res) {
  try {
    const { postId } = req.body;
    if (!postId) return res.status(400).json({ error: 'Missing postId' });
    const User = require('../models/User');
    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const postIdStr = String(postId);
    const index = user.saved_posts.findIndex(sp => sp.post_id === postIdStr);
    let saved = false;
    if (index > -1) {
      user.saved_posts.splice(index, 1);
    } else {
      user.saved_posts.push({ post_id: postIdStr, saved_at: new Date() });
      saved = true;
    }
    await user.save();
    res.json({ message: saved ? 'Post saved' : 'Post unsaved', saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getSavedItems(req, res) {
  try {
    const mongoose = require('mongoose');
    const User = require('../models/User');
    const Product = require('../models/Product');
    const Recipe = require('../models/Recipe');
    const Post = require('../models/Post');
    const Blog = require('../models/Blog');

    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const productIds = user.saved_products.map(sp => parseInt(sp.product_id)).filter(id => !isNaN(id));
    const products = await Product.find({ product_id: { $in: productIds } });

    const recipeIds = user.saved_recipes.map(sr => sr.recipe_id);
    const recipes = await Recipe.find({ recipe_id: { $in: recipeIds } });

    const postIds = user.saved_posts.map(sp => sp.post_id);
    const posts = await Post.find({ post_id: { $in: postIds } });

    const blogIds = user.saved_blogs.map(sb => sb.blog_id).filter(id => mongoose.Types.ObjectId.isValid(id));
    const blogs = await Blog.find({ _id: { $in: blogIds } });

    res.json({
      saved_products: user.saved_products.map(sp => {
        const prod = products.find(p => String(p.product_id) === sp.product_id);
        return { saved_at: sp.saved_at, product: prod || null };
      }).filter(item => item.product !== null),

      saved_recipes: user.saved_recipes.map(sr => {
        const rec = recipes.find(r => r.recipe_id === sr.recipe_id);
        return { saved_at: sr.saved_at, recipe: rec || null };
      }).filter(item => item.recipe !== null),

      saved_posts: user.saved_posts.map(sp => {
        const pst = posts.find(p => p.post_id === sp.post_id);
        return { saved_at: sp.saved_at, post: pst || null };
      }).filter(item => item.post !== null),

      saved_blogs: user.saved_blogs.map(sb => {
        const blg = blogs.find(b => String(b._id) === sb.blog_id);
        return { saved_at: sb.saved_at, blog: blg || null };
      }).filter(item => item.blog !== null)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Gửi OTP cập nhật Profile (Email / Phone)
async function sendProfileOtp(req, res) {
  try {
    const { type, value } = req.body;
    if (!type || !value) {
      return res.status(400).json({ error: 'Missing type or value.' });
    }

    if (type !== 'email' && type !== 'phone') {
      return res.status(400).json({ error: "Type must be 'email' or 'phone'." });
    }

    const { userCollection, otpCollection } = await getCollections();
    const userId = new ObjectId(req.user.user_id);

    // Chuẩn hóa
    const normalizedValue = type === 'email' ? value.trim().toLowerCase() : value.trim();

    // Check xem có trùng với thông tin hiện tại của chính user này không
    const currentUser = await userCollection.findOne({ _id: userId });
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (type === 'email' && currentUser.email === normalizedValue) {
      return res.status(400).json({
        error: 'This is already your current email address.',
        code: 'SAME_EMAIL'
      });
    }

    if (type === 'phone' && currentUser.phone === normalizedValue) {
      return res.status(400).json({
        error: 'This is already your current phone number.',
        code: 'SAME_PHONE'
      });
    }

    // Check xem value có trùng với tài khoản khác không
    const query = type === 'email' ? { email: normalizedValue } : { phone: normalizedValue };
    const userExists = await userCollection.findOne({
      ...query,
      _id: { $ne: userId }
    });

    if (userExists) {
      return res.status(409).json({
        error: type === 'email' ? 'This email is already used by another account.' : 'This phone number is already used by another account.',
        code: type === 'email' ? 'EMAIL_EXISTS' : 'PHONE_EXISTS'
      });
    }

    // Xóa OTP yêu cầu cũ của user này cho cùng type
    await otpCollection.deleteMany({
      user_id: userId,
      type
    });

    const otp = generateOTP();

    await otpCollection.insertOne({
      user_id: userId,
      type,
      value: normalizedValue,
      otp,
      attempts: 0,
      expiresAt: new Date(Date.now() + OTP_EXPIRE_MS),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log(`[PROFILE OTP] ${type} for user ${userId} (${normalizedValue}) -> ${otp}`);

    const maskedContact = type === 'email' ? maskEmail(normalizedValue) : maskPhone(normalizedValue);

    res.status(200).json({
      message: 'OTP sent.',
      maskedContact,
      channel: type,
      __mock: process.env.NODE_ENV !== 'production' ? otp : undefined
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Xác thực OTP và cập nhật Profile
async function verifyProfileOtp(req, res) {
  try {
    const { type, value, otp } = req.body;

    if (!type || !value || !otp) {
      return res.status(400).json({ error: 'Missing type, value, or OTP.', code: 'MISSING_FIELDS' });
    }

    const { userCollection, otpCollection } = await getCollections();
    const userId = new ObjectId(req.user.user_id);

    const normalizedValue = type === 'email' ? value.trim().toLowerCase() : value.trim();

    const pending = await otpCollection.findOne({
      user_id: userId,
      type,
      value: normalizedValue
    });

    if (!pending) {
      return res.status(404).json({
        error: 'Verification request not found.',
        code: 'OTP_NOT_FOUND'
      });
    }

    if (pending.expiresAt < new Date()) {
      await otpCollection.deleteOne({ _id: pending._id });
      return res.status(400).json({
        error: 'OTP has expired.',
        code: 'OTP_EXPIRED'
      });
    }

    if ((pending.attempts || 0) >= OTP_MAX_ATTEMPTS) {
      return res.status(400).json({
        error: 'Too many incorrect attempts. Please request a new code.',
        code: 'OTP_LOCKED'
      });
    }

    if (pending.otp !== otp) {
      const attempts = (pending.attempts || 0) + 1;
      const remaining = OTP_MAX_ATTEMPTS - attempts;

      await otpCollection.updateOne(
        { _id: pending._id },
        { $set: { attempts } }
      );

      if (remaining <= 0) {
        return res.status(400).json({
          error: 'Too many incorrect attempts. Please request a new code.',
          code: 'OTP_LOCKED'
        });
      }

      return res.status(400).json({
        error: `Incorrect OTP. ${remaining} attempts remaining.`,
        code: 'INVALID_OTP',
        remainingAttempts: remaining
      });
    }

    // Xác thực thành công -> Không cập nhật database ngay tại đây
    // Xóa OTP
    await otpCollection.deleteOne({ _id: pending._id });

    res.status(200).json({
      message: 'Verification successful.',
      success: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteSavedItemsBatch(req, res) {
  try {
    const { type, ids } = req.body;
    if (!type || !ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'Missing type or ids array' });
    }

    const User = require('../models/User');
    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const idSet = new Set(ids.map(id => String(id)));

    if (type === 'products') {
      user.saved_products = user.saved_products.filter(sp => !idSet.has(String(sp.product_id)));
    } else if (type === 'recipes') {
      user.saved_recipes = user.saved_recipes.filter(sr => !idSet.has(String(sr.recipe_id)));
      const Recipe = require('../models/Recipe');
      await Recipe.updateMany(
        { recipe_id: { $in: ids } },
        { $inc: { saves: -1 } }
      );
    } else if (type === 'posts') {
      user.saved_posts = user.saved_posts.filter(sp => !idSet.has(String(sp.post_id)));
    } else if (type === 'blogs') {
      user.saved_blogs = user.saved_blogs.filter(sb => !idSet.has(String(sb.blog_id)));
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    await user.save();
    res.json({ message: `${ids.length} items removed successfully` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  register,
  login,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  adminLogin,
  logout,
  refreshToken,
  getProfile,
  updateProfile,
  sendProfileOtp,
  verifyProfileOtp,
  changePassword,
  forgotPassword,  
  resetPassword,
  addAddress,
  updateAddress,
  deleteAddress,
  addPaymentMethod,
  deletePaymentMethod,
  toggleSavedProduct,
  toggleSavedRecipe,
  toggleSavedBlog,
  toggleSavedPost,
  getSavedItems,
  deleteSavedItemsBatch
};