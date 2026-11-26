import mongoose from 'mongoose';

/**
 * Notification (FEAT-01, v0.4)
 *
 * In-app notification for a single user, created via
 * src/services/notify.js and read through
 * src/routes/notificationRoutes.js (/api/notifications).
 */
const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      default: '',
    },
    body: {
      type: String,
      default: '',
    },
    link: {
      type: String,
      default: null,
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// The list endpoint filters { user, read } newest-first.
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
