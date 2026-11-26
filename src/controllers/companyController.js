import { Company, CompanyMember, COMPANY_MEMBER_ROLES } from '../models/Company.js';
import { User } from '../models/User.js';
import { Order } from '../models/Order.js';
import { logAudit } from '../utils/audit.js';
import { parsePagination, paginatedResponse } from '../utils/paginate.js';
import { logger } from '../utils/logger.js';

/**
 * Buyer company accounts (FEAT-10, v0.9) — mounted at /api/companies.
 *
 * Access model (mirrors the codebase's SEC-01 pattern): company data
 * is visible to members only. A non-member always gets 404 — never
 * 403 — so company IDs cannot be probed. Owner-only mutations report
 * 403 to a member who is not an owner (they may know the company
 * exists), and 404 to a non-member.
 */

const getMembership = (companyId, userId) =>
  CompanyMember.findOne({ company: companyId, user: userId });

// Load company + caller's membership; sends 404 and returns null when
// the company does not exist OR the caller is not a member.
const loadMemberCompany = async (req, res) => {
  const company = await Company.findById(req.params.id).catch(() => null);
  if (!company) {
    res.status(404).json({ success: false, message: 'Company not found' });
    return null;
  }
  const membership = await getMembership(company._id, req.user._id);
  if (!membership) {
    res.status(404).json({ success: false, message: 'Company not found' });
    return null;
  }
  return { company, membership };
};

// Same as loadMemberCompany, plus the caller must be an owner.
const loadOwnerCompany = async (req, res) => {
  const loaded = await loadMemberCompany(req, res);
  if (!loaded) return null;
  if (loaded.membership.role !== 'owner') {
    res.status(403).json({ success: false, message: 'Only a company owner can perform this action' });
    return null;
  }
  return loaded;
};

const memberView = (member) => ({
  user: member.user?._id ?? member.user,
  name: member.user?.customerName || '',
  email: member.user?.email || '',
  role: member.role,
});

// @desc Create a company; the creator becomes its owner member
// @route POST /api/companies
export const createCompany = async (req, res) => {
  try {
    const { name, spendLimit, creditTerms } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Company name is required' });
    }
    if (spendLimit !== undefined && spendLimit !== null) {
      const limit = Number(spendLimit);
      if (Number.isNaN(limit) || limit < 0) {
        return res.status(400).json({ success: false, message: 'spendLimit must be a non-negative number' });
      }
    }

    const company = await Company.create({
      name: String(name).trim(),
      spendLimit: spendLimit === undefined ? null : spendLimit,
      creditTerms: creditTerms || '',
      createdBy: req.user._id,
    });
    const membership = await CompanyMember.create({
      company: company._id,
      user: req.user._id,
      role: 'owner',
      invitedBy: req.user._id,
    });

    await logAudit(req, {
      action: 'company.create',
      entityType: 'Company',
      entityId: company._id,
      after: { name: company.name, spendLimit: company.spendLimit, creditTerms: company.creditTerms },
    });

    return res.status(201).json({
      success: true,
      message: `Company "${company.name}" created.`,
      data: { ...company.toObject(), role: membership.role },
      company: { ...company.toObject(), role: membership.role },
    });
  } catch (error) {
    logger.error('Error creating company', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc List the companies the caller belongs to (with the caller's role)
// @route GET /api/companies/mine
export const getMyCompanies = async (req, res) => {
  try {
    const memberships = await CompanyMember.find({ user: req.user._id }).populate('company');
    const data = memberships
      .filter((m) => m.company)
      .map((m) => ({ ...m.company.toObject(), role: m.role }));
    return res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get one company + its member list (members only)
// @route GET /api/companies/:id
export const getCompanyById = async (req, res) => {
  try {
    const loaded = await loadMemberCompany(req, res);
    if (!loaded) return;
    const { company, membership } = loaded;

    const members = await CompanyMember.find({ company: company._id }).populate(
      'user',
      'customerName email'
    );

    return res.status(200).json({
      success: true,
      data: {
        ...company.toObject(),
        role: membership.role,
        members: members.map(memberView),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Update company settings (owner only)
// @route PATCH /api/companies/:id
export const updateCompany = async (req, res) => {
  try {
    const loaded = await loadOwnerCompany(req, res);
    if (!loaded) return;
    const { company } = loaded;

    const { name, spendLimit, creditTerms } = req.body || {};
    const before = { name: company.name, spendLimit: company.spendLimit, creditTerms: company.creditTerms };

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Company name cannot be empty' });
      }
      company.name = String(name).trim();
    }
    if (spendLimit !== undefined) {
      if (spendLimit !== null) {
        const limit = Number(spendLimit);
        if (Number.isNaN(limit) || limit < 0) {
          return res.status(400).json({ success: false, message: 'spendLimit must be a non-negative number or null' });
        }
        company.spendLimit = limit;
      } else {
        company.spendLimit = null;
      }
    }
    if (creditTerms !== undefined) company.creditTerms = creditTerms || '';

    await company.save();

    await logAudit(req, {
      action: 'company.update',
      entityType: 'Company',
      entityId: company._id,
      before,
      after: { name: company.name, spendLimit: company.spendLimit, creditTerms: company.creditTerms },
    });

    return res.status(200).json({ success: true, data: company });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Add an existing user to the company by email (owner only)
// @route POST /api/companies/:id/members
export const addCompanyMember = async (req, res) => {
  try {
    const loaded = await loadOwnerCompany(req, res);
    if (!loaded) return;
    const { company } = loaded;

    const { email, role } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'An email is required to add a member' });
    }
    if (!COMPANY_MEMBER_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role "${role}". Must be one of: ${COMPANY_MEMBER_ROLES.join(', ')}`,
      });
    }

    const invited = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!invited) {
      return res.status(404).json({ success: false, message: 'No account exists for that email address' });
    }

    const existing = await getMembership(company._id, invited._id);
    if (existing) {
      return res.status(409).json({ success: false, message: 'That user is already a member of this company' });
    }

    let member;
    try {
      member = await CompanyMember.create({
        company: company._id,
        user: invited._id,
        role,
        invitedBy: req.user._id,
      });
    } catch (err) {
      // Unique (company, user) index race — same contract as the check above.
      if (err?.code === 11000) {
        return res.status(409).json({ success: false, message: 'That user is already a member of this company' });
      }
      throw err;
    }

    await logAudit(req, {
      action: 'company.member.add',
      entityType: 'Company',
      entityId: company._id,
      after: { user: invited._id.toString(), email: invited.email, role },
    });

    return res.status(201).json({
      success: true,
      message: `${invited.email} added to "${company.name}" as ${role}.`,
      data: { user: invited._id, name: invited.customerName, email: invited.email, role: member.role },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Change a member's role (owner only; founding owner is locked)
// @route PATCH /api/companies/:id/members/:userId
export const updateCompanyMemberRole = async (req, res) => {
  try {
    const loaded = await loadOwnerCompany(req, res);
    if (!loaded) return;
    const { company } = loaded;

    const { role } = req.body || {};
    if (!COMPANY_MEMBER_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role "${role}". Must be one of: ${COMPANY_MEMBER_ROLES.join(', ')}`,
      });
    }

    const member = await getMembership(company._id, req.params.userId).catch(() => null);
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    // The founding owner (company.createdBy) can never be demoted.
    if (company.createdBy.toString() === member.user.toString() && role !== 'owner') {
      return res.status(400).json({ success: false, message: 'The founding owner cannot be demoted' });
    }

    const before = { role: member.role };
    member.role = role;
    await member.save();

    await logAudit(req, {
      action: 'company.member.role',
      entityType: 'Company',
      entityId: company._id,
      before: { user: member.user.toString(), ...before },
      after: { user: member.user.toString(), role },
    });

    return res.status(200).json({
      success: true,
      data: { user: member.user, role: member.role },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Remove a member (owner only; founding owner is locked)
// @route DELETE /api/companies/:id/members/:userId
export const removeCompanyMember = async (req, res) => {
  try {
    const loaded = await loadOwnerCompany(req, res);
    if (!loaded) return;
    const { company } = loaded;

    const member = await getMembership(company._id, req.params.userId).catch(() => null);
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    // The founding owner (company.createdBy) can never be removed.
    if (company.createdBy.toString() === member.user.toString()) {
      return res.status(400).json({ success: false, message: 'The founding owner cannot be removed' });
    }

    await member.deleteOne();

    await logAudit(req, {
      action: 'company.member.remove',
      entityType: 'Company',
      entityId: company._id,
      before: { user: member.user.toString(), role: member.role },
    });

    return res.status(200).json({ success: true, message: 'Member removed.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc List the company's orders (any member; viewing only)
// @route GET /api/companies/:id/orders
export const getCompanyOrders = async (req, res) => {
  try {
    const loaded = await loadMemberCompany(req, res);
    if (!loaded) return;
    const { company } = loaded;

    const { page, limit, skip } = parsePagination(req);
    const filter = { company: company._id };
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments(filter),
    ]);
    return paginatedResponse(res, { items: orders, total, page, limit });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
