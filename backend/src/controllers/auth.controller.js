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

// Lấy thông tin trang cá nhân (Get Profile)
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
    user.addresses = user.addresses || [];
    user.payment_methods = user.payment_methods || [];
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Cập nhật trang cá nhân (Update Profile)
async function updateProfile(req, res) {
  try {
    const { ObjectId } = require('mongodb');
    const { profile_name, email, phone } = req.body;

    if (!profile_name) {
      return res.status(400).json({ error: 'Họ và tên không được để trống.' });
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
        return res.status(409).json({ error: 'Email đã được sử dụng bởi tài khoản khác.' });
      }
    }

    // Kiểm tra trùng số điện thoại
    if (phone) {
      const phoneUser = await userCollection.findOne({
        phone: phone.trim(),
        _id: { $ne: userId }
      });
      if (phoneUser) {
        return res.status(409).json({ error: 'Số điện thoại đã được sử dụng bởi tài khoản khác.' });
      }
    }

    const updateFields = {
      profile_name: profile_name.trim(),
      updatedAt: new Date()
    };
    if (email) updateFields.email = email.trim();
    if (phone) updateFields.phone = phone.trim();

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

// Đổi mật khẩu (Change Password)
async function changePassword(req, res) {
  try {
    const { ObjectId } = require('mongodb');
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Vui lòng cung cấp mật khẩu cũ và mật khẩu mới.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 8 ký tự.' });
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

async function addAddress(req, res) {
  try {
    const { recipient_name, phone, city, detail_address, label, is_default } = req.body;
    if (!recipient_name || !phone || !city || !detail_address) {
      return res.status(400).json({ error: 'Missing required address fields.' });
    }

    const { userCollection } = await getCollections();
    const { ObjectId } = require('mongodb');
    const userId = new ObjectId(req.user.user_id);

    // Check current addresses
    const user = await userCollection.findOne({ _id: userId });
    const currentAddresses = user.addresses || [];

    // Rule: If first address, it MUST be default
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

    // Rule: If only 1 address exists, it MUST be default
    let finalIsDefault = is_default;
    if (currentAddresses.length === 1) {
      finalIsDefault = true;
    } else if (is_default === false && targetAddress.is_default) {
      // User tries to unset default. Switch default to another address.
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

module.exports = {
  register,
  login,
  adminLogin,
  logout,
  refreshToken,
  getProfile,
  updateProfile,
  changePassword,
  addAddress,
  updateAddress,
  deleteAddress,
  addPaymentMethod,
  deletePaymentMethod
};

