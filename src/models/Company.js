import mongoose from 'mongoose';

/**
 * Company (FEAT-10, v0.9) — buyer company accounts.
 *
 * A company groups several buyer logins (CompanyMember rows) so a
 * business can order under one account with role-based approval:
 * orders whose total exceeds the company's spendLimit must be approved
 * by a member with role 'approver' or 'owner' before staff can confirm
 * them (see the approval fields on the Order model and the guard in
 * orderController.updateOrderStatus).
 *
 * spendLimit semantics: null (the default) means NO approval is ever
 * required — the field is "unset". A numeric value (including 0) is a
 * real limit: an order whose stored totalAmount is strictly greater
 * than spendLimit goes to approvalStatus 'pending'. 0 therefore means
 * "every non-free order needs approval".
 */
const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
    },
    spendLimit: {
      type: Number,
      default: null,
      min: [0, 'Spend limit cannot be negative'],
    },
    creditTerms: {
      type: String,
      default: '',
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

export const Company = mongoose.model('Company', companySchema);

export const COMPANY_MEMBER_ROLES = ['owner', 'purchaser', 'approver', 'finance'];

const companyMemberSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: COMPANY_MEMBER_ROLES,
      required: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// One membership row per (company, user) — duplicates are impossible
// at the DB level; the controller maps the 11000 to a 409.
companyMemberSchema.index({ company: 1, user: 1 }, { unique: true });

export const CompanyMember = mongoose.model('CompanyMember', companyMemberSchema);
