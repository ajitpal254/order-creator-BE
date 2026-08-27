import { User } from '../models/User.js';
import { generateToken } from '../utils/token.js';
import crypto from 'crypto';

// @desc Register a new user
// @route POST /api/auth/signup
export const signup = async (req, res) => {
  try {
    const {
      customerName,
      businessName,
      country,
      phoneNumber,
      address,
      username,
      email,
      password,
    } = req.body;

    // Strict validation
    if (
      !customerName ||
      !businessName ||
      !country ||
      !phoneNumber ||
      !address ||
      !username ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: 'All fields (Customer Name, Business, Country, Phone, Address, Username, Email, Password) are required.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
    }

    // Check existing
    const existingUser = await User.findOne({
      $or: [{ username: username.toLowerCase().trim() }, { email: email.toLowerCase().trim() }],
    });

    if (existingUser) {
      const isUsernameMatch = existingUser.username === username.toLowerCase().trim();
      return res.status(400).json({
        success: false,
        message: isUsernameMatch
          ? 'Username is already taken. Please choose another one.'
          : 'Email is already registered. Please log in instead.',
      });
    }

    const newUser = new User({
      customerName: customerName.trim(),
      businessName: businessName.trim(),
      country: country.trim(),
      phoneNumber: phoneNumber.trim(),
      address: address.trim(),
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      password: password,
      role: 'user',
    });

    await newUser.save();

    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully! Welcome to H.A. Overseas.',
      token,
      user: {
        id: newUser._id,
        customerName: newUser.customerName,
        businessName: newUser.businessName,
        country: newUser.country,
        phoneNumber: newUser.phoneNumber,
        address: newUser.address,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error('[Auth Signup Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create account. Please try again.',
      error: error.message,
    });
  }
};

// @desc Login user / admin
// @route POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;

    if (!usernameOrEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both username/email and password.',
      });
    }

    const cleanIdentifier = usernameOrEmail.toLowerCase().trim();

    const user = await User.findOne({
      $or: [{ username: cleanIdentifier }, { email: cleanIdentifier }],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. User not found.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account is deactivated. Please contact H.A. Overseas support.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Incorrect password.',
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${user.customerName || user.username}!`,
      token,
      user: {
        id: user._id,
        customerName: user.customerName,
        businessName: user.businessName,
        country: user.country,
        phoneNumber: user.phoneNumber,
        address: user.address,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('[Auth Login Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed due to a server error.',
      error: error.message,
    });
  }
};

// @desc Google / Firebase OAuth login
// @route POST /api/auth/google
export const googleAuth = async (req, res) => {
  try {
    const { email, customerName, firebaseUid, photoUrl } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required for Google Sign-In.',
      });
    }

    let user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      // Auto-provision Google user
      const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'user';
      const uniqueUsername = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;
      const randomPassword = crypto.randomBytes(24).toString('hex') + 'Aa1!';

      user = new User({
        customerName: customerName || 'Google User',
        businessName: 'Individual / Buyer',
        country: 'International',
        phoneNumber: '+00 000000000',
        address: 'Google Sign-in Registered',
        username: uniqueUsername,
        email: email.toLowerCase().trim(),
        password: randomPassword,
        firebaseUid: firebaseUid || null,
        role: 'user',
      });

      await user.save();
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Google Sign-in successful!',
      token,
      user: {
        id: user._id,
        customerName: user.customerName,
        businessName: user.businessName,
        country: user.country,
        phoneNumber: user.phoneNumber,
        address: user.address,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('[Google Auth Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Google authentication failed.',
      error: error.message,
    });
  }
};

// @desc Forgot Password request
// @route POST /api/auth/forgot-password
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please provide your registered email address.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Return positive message for security reasons
      return res.status(200).json({
        success: true,
        message: 'If an account exists with that email, password reset instructions have been dispatched.',
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 mins
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password reset link generated. (In production, this is emailed to the user).',
      debugResetToken: resetToken, // For development convenience
    });
  } catch (error) {
    console.error('[Forgot Password Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to process forgot password request.' });
  }
};

// @desc Reset Password with token
// @route POST /api/auth/reset-password
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Valid token and new password (min 6 chars) are required.' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Password reset token is invalid or has expired.' });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now log in.',
    });
  } catch (error) {
    console.error('[Reset Password Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to reset password.' });
  }
};

// @desc Get Current Logged in User Profile
// @route GET /api/auth/me
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Update Current User Profile
// @route PUT /api/auth/profile
export const updateProfile = async (req, res) => {
  try {
    const { customerName, businessName, country, phoneNumber, address } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (customerName) user.customerName = customerName.trim();
    if (businessName) user.businessName = businessName.trim();
    if (country) user.country = country.trim();
    if (phoneNumber) user.phoneNumber = phoneNumber.trim();
    if (address) user.address = address.trim();

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: {
        id: user._id,
        customerName: user.customerName,
        businessName: user.businessName,
        country: user.country,
        phoneNumber: user.phoneNumber,
        address: user.address,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
