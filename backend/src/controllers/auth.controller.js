const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getCollections } = require('../config/db');

// Đăng ký tài khoản mới (Register)
async function register(req, res) {
  try {
    const { email, password, name, profile_name } = req.body;
    const displayName = profile_name || name;
    
    // Validation cơ bản
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin: email, password, profile_name.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu phải chứa ít nhất 8 ký tự.' });
    }

    const { userCollection } = await getCollections();
    
    // Kiểm tra trùng email
    const existing = await userCollection.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'Email đã tồn tại trong hệ thống.' });
    }

    // Sinh user_id tuần tự kiểu USRXXXXX
    const lastUser = await userCollection.findOne({}, { sort: { user_id: -1 } });
    let nextNum = 1;
    if (lastUser && lastUser.user_id) {
      const match = lastUser.user_id.match(/USR(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    const user_id = `USR${String(nextNum).padStart(5, '0')}`;

    // Tự động hash mật khẩu với saltRounds = 10
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = {
      user_id,
      password_hash: hashedPassword,
      oauth_providers: [],
      profile_name: displayName,
      role: 'customer',
      status: 'active',
      addresses: [],
      payment_methods: [],
      saved_products: [],
      saved_recipes: [],
      saved_posts: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (email) newUser.email = email;
    if (req.body.phone) newUser.phone = req.body.phone;
    if (req.body.community_name) newUser.community_name = req.body.community_name;
    if (req.body.avatar_url) newUser.avatar_url = req.body.avatar_url;

    const result = await userCollection.insertOne(newUser);

    // Ký JWT Token (Payload: user_id tương ứng với _id trong DB để đồng bộ với middleware cũ)
    const secret = process.env.JWT_SECRET || 'fallback-secret-key';
    const token = jwt.sign(
      { user_id: result.insertedId, email, role: newUser.role },
      secret,
      { expiresIn: '8h' }
    );

    res.status(201).json({
      message: 'Đăng ký tài khoản thành công',
      token,
      user: {
        _id: result.insertedId,
        user_id: newUser.user_id,
        email,
        profile_name: newUser.profile_name,
        role: newUser.role
      }
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

    // Chuẩn hoá email / phone: loại bỏ khoảng trắng ở đầu và cuối.
    // Nếu là số điện thoại (không chứa ký tự '@'), loại bỏ hoàn toàn khoảng trắng bên trong.
    let identifier = String(email).trim();
    if (identifier && !identifier.includes('@')) {
      identifier = identifier.replace(/\s+/g, '');
    }

    const { userCollection } = await getCollections();
    
    // Tìm user bằng email hoặc phone (sau khi đã chuẩn hoá)
    const user = await userCollection.findOne({
      $or: [
        { email: identifier },
        { phone: identifier }
      ]
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Tài khoản không tồn tại trong hệ thống.', code: 'ACCOUNT_NOT_FOUND' });
    }

    // Nếu là tài khoản OAuth (không có password_hash)
    if (!user.password_hash) {
      return res.status(400).json({ error: 'Tài khoản này được đăng ký thông qua mạng xã hội.', code: 'OAUTH_ACCOUNT' });
    }

    // Kiểm tra phân quyền: admin không được đăng nhập tại đây
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Tài khoản admin không được phép đăng nhập tại đây.', code: 'ADMIN_NOT_ALLOWED' });
    }

    // So sánh password plain với password_hash
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Mật khẩu không chính xác.', code: 'INCORRECT_PASSWORD' });
    }

    // Ký JWT Token
    const secret = process.env.JWT_SECRET || 'fallback-secret-key';
    const token = jwt.sign(
      { user_id: user._id, email: user.email || '', role: user.role },
      secret,
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Đăng nhập thành công',
      token,
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

// Đăng nhập Admin (chỉ role admin)
async function adminLogin(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Vui lòng cung cấp email và password.', code: 'MISSING_FIELDS' });
    }

    const identifier = String(email).trim();
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

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Mật khẩu không chính xác.', code: 'INCORRECT_PASSWORD' });
    }

    const secret = process.env.JWT_SECRET || 'fallback-secret-key';
    const token = jwt.sign(
      { user_id: user._id, email: user.email || '', role: user.role },
      secret,
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
    res.status(500).json({ error: error.message });
  }
}

// Đăng xuất (Logout)
async function logout(req, res) {
  res.json({ message: 'Đăng xuất thành công.' });
}

// Refresh Token placeholder
async function refreshToken(req, res) {
  res.json({ message: 'Tính năng Refresh Token đang phát triển.' });
}

module.exports = {
  register,
  login,
  adminLogin,
  logout,
  refreshToken
};

