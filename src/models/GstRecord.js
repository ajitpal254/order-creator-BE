import mongoose from 'mongoose';

const gstRecordSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', unique: true, required: true, index: true },
    irn: { type: String, default: null },
    ackNo: { type: String, default: null },
    ackDate: { type: Date, default: null },
    signedQrPayload: { type: String, default: null },
    status: { type: String, enum: ['not_generated', 'pending', 'generated', 'failed'], default: 'not_generated' },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

export const GstRecord = mongoose.model('GstRecord', gstRecordSchema);
