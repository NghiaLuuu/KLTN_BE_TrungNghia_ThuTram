const jwt = require('jsonwebtoken');

exports.generateAccessToken = (user, selectedRole = null) => {
  // selectedRole: Role user selected at login/selectRole
  // If not provided, use first role in array as default
  const activeRole = selectedRole || user.roles?.[0];
  
  return jwt.sign(
    {
      userId: user._id,
      roles: user.roles,                  // ✅ All available roles
      activeRole: activeRole,             // ✅ Currently selected/active role
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: '1d',
    }
  );
};


exports.generateRefreshToken = (user, selectedRole = null) => {
  // selectedRole: Role user selected at login/selectRole
  // If not provided, use first role in array as default
  const activeRole = selectedRole || user.roles?.[0];
  
  return jwt.sign(
    {
      userId: user._id,
      roles: user.roles,                  // ✅ All available roles
      activeRole: activeRole,             // ✅ Currently selected/active role
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: '7d',
    }
  );
};


exports.isTokenExpired = (token) => {
  try {
    const decoded = jwt.decode(token);
    return decoded.exp * 1000 < Date.now(); // so sánh với thời gian hiện tại
  } catch (err) {
    return true;
  }
};
