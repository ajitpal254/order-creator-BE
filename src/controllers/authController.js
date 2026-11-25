import { User } from '../models/User.js';
import { RefreshSession } from '../models/RefreshSession.js';
import {
  generateAccessToken,
  verifyRefreshToken,
  createRefreshSession,
  findRefreshSessionByToken,
  hashRefreshToken,
  revokeAllRefreshSessions,
  generateTwoFactorChallengeToken,
  verifyTwoFactorChallengeToken,
} from '../utils/token.js';
import {
  generateTotpSecret,
  verifyTotp,
  buildOtpAuthUri,
  generateBackupCodes,
  hashBackupCode,
} from '../utils/totp.js';
import { logAudit } from '../utils/audit.js';
import { sendPasswordResetEmail } from '../utils/emailService.js';
import { isValidPhone, normalizePhone } from '../services/messaging.js';
import crypto from 'crypto';

const REFRESH_COOKIE_NAME = 'hao_refresh_token';
// The refresh cookie must travel cross-site in production (frontend on
// Netlify, API on Render), so it needs SameSite=None there. Strict would
// mean the browser never sends it back and refresh silently stops working.
// None requires Secure, which is already on in production.
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// FEAT-13 (v0.4): staff roles are every role except buyers.
const STAFF_ROLES = [
  'admin',
  'sales_manager',
  'production_supervisor',
  'qc_inspector',
  'shipping_officer',
  'super_admin',
];
const isStaffRole = (role) => STAFF_ROLES.includes(role);

const requestMeta = (req) => ({
  userAgent: req?.headers?.['user-agent'] || '',
  ip: req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '',
});

// Issues a new access token + a new RefreshSession, setting the raw
// refresh token ONLY as an httpOnly cookie (never in the JSON body).
// Returns the created session so callers (refresh rotation) can link
// the previous session to it via replacedBy.
const sendAuthResponse = async (req, res, statusCode, user, message) => {
  const accessToken = generateAccessToken(user);
  const { rawToken, session } = await createRefreshSession(user, requestMeta(req));

  res.cookie(REFRESH_COOKIE_NAME, rawToken, COOKIE_OPTIONS);

  res.status(statusCode).json({
    success: true,
    message,
    token: accessToken,
    accessToken,
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
      distributorTier: user.distributorTier,
    },
  });
  return session;
};

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

    return await sendAuthResponse(
      req,
      res,
      201,
      newUser,
      'Account created successfully! Welcome to H.A. Overseas.'
    );
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

    const cleanIdentifier = usernameOrEmail.toLowerCase().trim();

    const user = await User.findOne({
      $or: [{ username: cleanIdentifier }, { email: cleanIdentifier }],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
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
        message: 'Invalid email or password',
      });
    }

    // FEAT-13 (v0.4): staff users with 2FA enabled do not get a session
    // yet — they get a short-lived challenge token and must complete
    // POST /api/auth/2fa/verify. Buyers never enter this branch.
    if (user.twoFactorEnabled && isStaffRole(user.role)) {
      return res.status(200).json({
        success: true,
        requires2fa: true,
        challengeToken: generateTwoFactorChallengeToken(user),
      });
    }

    return await sendAuthResponse(
      req,
      res,
      200,
      user,
      `Welcome back, ${user.customerName || user.username}!`
    );
  } catch (error) {
    console.error('[Auth Login Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed due to a server error.',
      error: error.message,
    });
  }
};

// @desc Refresh Access Token using HttpOnly Refresh Token
// @route POST /api/auth/refresh
export const refreshTokenHandler = async (req, res) => {
  try {
    // SEC-07: the refresh token is accepted from the httpOnly cookie
    // ONLY. A token supplied in the JSON body is never honoured.
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token missing. Please log in again.',
      });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE_NAME, COOKIE_OPTIONS);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token. Please log in again.',
      });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      res.clearCookie(REFRESH_COOKIE_NAME, COOKIE_OPTIONS);
      return res.status(401).json({
        success: false,
        message: 'Session revoked or user inactive.',
      });
    }

    const session = await findRefreshSessionByToken(refreshToken);
    if (!session || String(session.user) !== String(user._id) || session.expiresAt <= new Date()) {
      res.clearCookie(REFRESH_COOKIE_NAME, COOKIE_OPTIONS);
      return res.status(401).json({
        success: false,
        message: 'Refresh token has been invalidated or rotated.',
      });
    }

    // REUSE DETECTION: a rotated/revoked token being presented again
    // means it was likely stolen — kill the user's whole session family.
    if (session.status !== 'active') {
      await revokeAllRefreshSessions(user._id);
      res.clearCookie(REFRESH_COOKIE_NAME, COOKIE_OPTIONS);
      return res.status(401).json({
        success: false,
        message: 'Refresh token reuse detected. All sessions have been revoked.',
      });
    }

    // Rotation: mark the old session rotated (kept until expiry so a
    // replay of it is detectable above), then issue a fresh session.
    // updateOne (not doc.save()) so a row deleted mid-flight — e.g. by a
    // concurrent revoke-all — is a no-op rather than DocumentNotFound.
    await RefreshSession.updateOne({ _id: session._id }, { $set: { status: 'rotated' } });

    const newSession = await sendAuthResponse(req, res, 200, user, 'Token refreshed successfully');
    if (newSession?._id) {
      // Best-effort linkage: the response is already sent, so a failure
      // here must never turn a successful refresh into a 500.
      try {
        await RefreshSession.updateOne(
          { _id: session._id },
          { $set: { replacedBy: newSession._id } }
        );
      } catch (linkErr) {
        console.error('[Token Refresh] Failed to link rotated session', linkErr);
      }
    }
    return newSession;
  } catch (error) {
    console.error('[Token Refresh Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to refresh token.',
      error: error.message,
    });
  }
};

// @desc Logout user & clear refresh cookies
// @route POST /api/auth/logout
export const logout = async (req, res) => {
  try {
    // SEC-07: cookie only (no body fallback). Deletes ONLY the
    // presented session; the user's other sessions stay alive.
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

    if (refreshToken) {
      await RefreshSession.deleteOne({ tokenHash: hashRefreshToken(refreshToken) });
    }

    res.clearCookie(REFRESH_COOKIE_NAME, COOKIE_OPTIONS);

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error during logout.',
      error: error.message,
    });
  }
};

// @desc Google / Firebase OAuth login
// @route POST /api/auth/google
export const googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;

    // Identity is derived ONLY from the verified token response below.
    // Email, name and uid supplied in the request body are never trusted,
    // in any environment.
    if (!idToken) {
      return res.status(401).json({
        success: false,
        message: 'Google ID token is required for authentication.',
      });
    }

    let email;
    let customerName;
    let firebaseUid;

    // Cryptographic server-side verification of Google/Firebase ID token
    try {
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );
      if (!verifyRes.ok) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired Google authentication token.',
        });
      }
      const tokenData = await verifyRes.json();

      // The token must have been issued for this project.
      if (!process.env.FIREBASE_PROJECT_ID || tokenData.aud !== process.env.FIREBASE_PROJECT_ID) {
        return res.status(401).json({
          success: false,
          message: 'Google authentication token was not issued for this application.',
        });
      }

      // tokeninfo returns string values, so accept both "true" and true.
      const emailVerified = tokenData.email_verified === true || tokenData.email_verified === 'true';
      if (!emailVerified) {
        return res.status(401).json({
          success: false,
          message: 'Google account email is not verified.',
        });
      }

      email = tokenData.email;
      firebaseUid = tokenData.sub;
      customerName = tokenData.name;
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Failed to verify Google identity: ' + err.message,
      });
    }

    if (!email) {
      return res.status(401).json({
        success: false,
        message: 'Email is required for Google Sign-In.',
      });
    }

    let user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
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

    return await sendAuthResponse(req, res, 200, user, 'Google Sign-in successful!');

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
      return res.status(200).json({
        success: true,
        message: 'If an account exists with that email, password reset instructions have been dispatched.',
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 mins
    await user.save();

    // Send the reset link by email. The response stays generic either way
    // so it never reveals whether the account exists. Email delivery needs
    // SMTP_HOST/SMTP_USER/SMTP_PASS configured; without them the mailer
    // logs a simulated send instead of failing the request.
    const frontendOrigin = (process.env.CLIENT_URL || 'http://localhost:5173')
      .split(',')
      .map((url) => url.trim().replace(/\/$/, ''))
      .filter(Boolean)[0];
    const resetUrl = `${frontendOrigin}/reset-password?token=${resetToken}`;
    const emailResult = await sendPasswordResetEmail({ to: user.email, resetUrl });
    if (!emailResult?.success) {
      console.error('[Forgot Password] Reset email failed to send', { email: user.email });
    }

    return res.status(200).json({
      success: true,
      message: 'If an account exists with that email, password reset instructions have been dispatched.',
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
    if (!token || !newPassword || newPassword.length < 10) {
      return res.status(400).json({ success: false, message: 'Valid token and new password (min 10 chars) are required.' });
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

    // SEC-07: a password reset revokes every existing session.
    await revokeAllRefreshSessions(user._id);

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now log in.',
    });
  } catch (error) {
    console.error('[Reset Password Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to reset password.' });
  }
};

// ── FEAT-13 (v0.4): staff TOTP two-factor authentication ─────────────

const INVALID_2FA_CODE = { success: false, message: 'Invalid authentication code' };

const loadUserWith2fa = (id) =>
  User.findById(id).select('+twoFactorSecret +twoFactorBackupCodes');

// @desc Begin 2FA setup: store a pending secret (does NOT enable 2FA)
// @route POST /api/auth/2fa/setup
export const setupTwoFactor = async (req, res) => {
  try {
    if (!isStaffRole(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Two-factor authentication is available to staff accounts only.' });
    }
    const user = await loadUserWith2fa(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const secret = generateTotpSecret();
    user.twoFactorSecret = secret;
    // Pending state only: twoFactorEnabled is left untouched (false for
    // a first-time setup). Re-running setup overwrites the pending secret.
    await user.save();

    return res.status(200).json({
      success: true,
      secret,
      otpauthUri: buildOtpAuthUri({ secret, account: user.email || user.username }),
    });
  } catch (error) {
    console.error('[2FA Setup Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to set up two-factor authentication.' });
  }
};

// @desc Enable 2FA after proving possession of the pending secret
// @route POST /api/auth/2fa/enable
export const enableTwoFactor = async (req, res) => {
  try {
    if (!isStaffRole(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Two-factor authentication is available to staff accounts only.' });
    }
    const user = await loadUserWith2fa(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.twoFactorSecret) {
      return res.status(400).json({ success: false, message: 'Two-factor setup has not been started.' });
    }
    if (!verifyTotp(user.twoFactorSecret, req.body?.code)) {
      return res.status(401).json(INVALID_2FA_CODE);
    }

    const backupCodes = generateBackupCodes();
    user.twoFactorEnabled = true;
    user.twoFactorBackupCodes = backupCodes.map(hashBackupCode);
    await user.save();

    await logAudit(req, {
      action: 'auth.2fa_enable',
      entityType: 'User',
      entityId: user._id,
      after: { twoFactorEnabled: true },
    });

    // The ONLY place plaintext backup codes are ever returned.
    return res.status(200).json({ success: true, backupCodes });
  } catch (error) {
    console.error('[2FA Enable Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to enable two-factor authentication.' });
  }
};

// @desc Disable 2FA with a TOTP code or an unused backup code
// @route POST /api/auth/2fa/disable
export const disableTwoFactor = async (req, res) => {
  try {
    if (!isStaffRole(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Two-factor authentication is available to staff accounts only.' });
    }
    const user = await loadUserWith2fa(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.twoFactorEnabled) {
      return res.status(400).json({ success: false, message: 'Two-factor authentication is not enabled.' });
    }

    const code = req.body?.code;
    const totpOk = user.twoFactorSecret ? verifyTotp(user.twoFactorSecret, code) : false;
    const backupOk =
      !totpOk && code ? (user.twoFactorBackupCodes || []).includes(hashBackupCode(code)) : false;
    if (!totpOk && !backupOk) {
      return res.status(401).json(INVALID_2FA_CODE);
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.twoFactorBackupCodes = [];
    await user.save();

    await logAudit(req, {
      action: 'auth.2fa_disable',
      entityType: 'User',
      entityId: user._id,
      after: { twoFactorEnabled: false },
    });

    return res.status(200).json({ success: true, message: 'Two-factor authentication has been disabled.' });
  } catch (error) {
    console.error('[2FA Disable Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to disable two-factor authentication.' });
  }
};

// @desc Complete a 2FA login challenge (challenge token is the credential)
// @route POST /api/auth/2fa/verify
export const verifyTwoFactor = async (req, res) => {
  try {
    const { challengeToken, code } = req.body || {};
    if (!challengeToken || !code) {
      return res.status(401).json(INVALID_2FA_CODE);
    }

    let decoded;
    try {
      decoded = verifyTwoFactorChallengeToken(challengeToken);
    } catch {
      return res.status(401).json(INVALID_2FA_CODE);
    }

    const user = await loadUserWith2fa(decoded.sub);
    if (!user || !user.isActive || !user.twoFactorEnabled || !isStaffRole(user.role)) {
      return res.status(401).json(INVALID_2FA_CODE);
    }

    if (user.twoFactorSecret && verifyTotp(user.twoFactorSecret, code)) {
      return await sendAuthResponse(
        req,
        res,
        200,
        user,
        `Welcome back, ${user.customerName || user.username}!`
      );
    }

    // Single-use backup code: remove its hash before completing login.
    const suppliedHash = hashBackupCode(code);
    const backupIndex = (user.twoFactorBackupCodes || []).indexOf(suppliedHash);
    if (backupIndex !== -1) {
      user.twoFactorBackupCodes.splice(backupIndex, 1);
      await user.save();
      return await sendAuthResponse(
        req,
        res,
        200,
        user,
        `Welcome back, ${user.customerName || user.username}!`
      );
    }

    return res.status(401).json(INVALID_2FA_CODE);
  } catch (error) {
    console.error('[2FA Verify Error]', error);
    return res.status(401).json(INVALID_2FA_CODE);
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
    const { customerName, businessName, country, phoneNumber, address, phone, notifications } =
      req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (customerName) user.customerName = customerName.trim();
    if (businessName) user.businessName = businessName.trim();
    if (country) user.country = country.trim();
    if (phoneNumber) user.phoneNumber = phoneNumber.trim();
    if (address) user.address = address.trim();

    // FEAT-11 (v0.8): WhatsApp phone + opt-in. The phone must be
    // E.164-ish (leading +, 8–15 digits); an empty string clears it.
    // Invalid values are rejected with 400 before anything is saved.
    if (phone !== undefined) {
      if (phone === null || phone === '') {
        user.phone = '';
      } else if (!isValidPhone(phone)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid phone number. Use international format: + followed by 8–15 digits.',
        });
      } else {
        user.phone = normalizePhone(phone);
      }
    }
    if (notifications && typeof notifications === 'object') {
      if (notifications.whatsapp !== undefined) {
        user.notifications.whatsapp = Boolean(notifications.whatsapp);
      }
      if (notifications.email !== undefined) {
        user.notifications.email = Boolean(notifications.email);
      }
    }

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
        phone: user.phone,
        notifications: {
          email: user.notifications?.email,
          whatsapp: user.notifications?.whatsapp,
        },
        address: user.address,
        username: user.username,
        email: user.email,
        role: user.role,
        distributorTier: user.distributorTier,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
