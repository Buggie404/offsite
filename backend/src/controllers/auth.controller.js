// Auth controller placeholders
async function register(req, res) {
  res.json({ message: 'Auth register placeholder' });
}

async function login(req, res) {
  res.json({ message: 'Auth login placeholder' });
}

async function logout(req, res) {
  res.json({ message: 'Auth logout placeholder' });
}

async function refreshToken(req, res) {
  res.json({ message: 'Auth refresh token placeholder' });
}

module.exports = {
  register,
  login,
  logout,
  refreshToken
};
