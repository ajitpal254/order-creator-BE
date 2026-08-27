import { Category, Finish, Color, Brand, Size } from '../models/Attributes.js';

// @desc Get all master attributes (Public / User / Admin)
// @route GET /api/attributes
export const getAllAttributes = async (req, res) => {
  try {
    const [categories, finishes, colors, brands, sizes] = await Promise.all([
      Category.find({ isActive: true }).sort({ name: 1 }),
      Finish.find({ isAvailable: true }).sort({ name: 1 }),
      Color.find({ isAvailable: true }).sort({ name: 1 }),
      Brand.find({ isAvailable: true }).sort({ name: 1 }),
      Size.find({ isAvailable: true }).sort({ label: 1 }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        categories,
        finishes,
        colors,
        brands,
        sizes,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== FINISHES ====================
export const getFinishes = async (req, res) => {
  try {
    const data = await Finish.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addFinish = async (req, res) => {
  try {
    const { name, code, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Finish name is required' });

    const finish = await Finish.create({ name, code, description });
    res.status(201).json({ success: true, message: 'Finish added successfully', data: finish });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateFinish = async (req, res) => {
  try {
    const finish = await Finish.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!finish) return res.status(404).json({ success: false, message: 'Finish not found' });
    res.status(200).json({ success: true, message: 'Finish updated', data: finish });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteFinish = async (req, res) => {
  try {
    await Finish.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Finish deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ==================== COLORS ====================
export const getColors = async (req, res) => {
  try {
    const data = await Color.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addColor = async (req, res) => {
  try {
    const { name, hexCode, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Color name is required' });

    const color = await Color.create({ name, hexCode: hexCode || '#000000', description });
    res.status(201).json({ success: true, message: 'Color added successfully', data: color });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateColor = async (req, res) => {
  try {
    const color = await Color.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!color) return res.status(404).json({ success: false, message: 'Color not found' });
    res.status(200).json({ success: true, message: 'Color updated', data: color });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteColor = async (req, res) => {
  try {
    await Color.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Color deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ==================== BRANDS ====================
export const getBrands = async (req, res) => {
  try {
    const data = await Brand.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addBrand = async (req, res) => {
  try {
    const { name, isCustom, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Brand name is required' });

    const brand = await Brand.create({ name, isCustom: Boolean(isCustom), description });
    res.status(201).json({ success: true, message: 'Brand added successfully', data: brand });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateBrand = async (req, res) => {
  try {
    const brand = await Brand.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!brand) return res.status(404).json({ success: false, message: 'Brand not found' });
    res.status(200).json({ success: true, message: 'Brand updated', data: brand });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteBrand = async (req, res) => {
  try {
    await Brand.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Brand deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ==================== SIZES ====================
export const getSizes = async (req, res) => {
  try {
    const data = await Size.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addSize = async (req, res) => {
  try {
    const { label, unit, categoryType } = req.body;
    if (!label) return res.status(400).json({ success: false, message: 'Size label is required' });

    const size = await Size.create({ label, unit: unit || '', categoryType: categoryType || 'General' });
    res.status(201).json({ success: true, message: 'Size added successfully', data: size });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateSize = async (req, res) => {
  try {
    const size = await Size.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!size) return res.status(404).json({ success: false, message: 'Size not found' });
    res.status(200).json({ success: true, message: 'Size updated', data: size });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteSize = async (req, res) => {
  try {
    await Size.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Size deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ==================== CATEGORIES ====================
export const getCategories = async (req, res) => {
  try {
    const data = await Category.find().sort({ name: 1 });
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addCategory = async (req, res) => {
  try {
    const { name, description, icon } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const category = await Category.create({ name, slug, description, icon });
    res.status(201).json({ success: true, message: 'Category added successfully', data: category });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const { name, description, icon, isActive } = req.body;
    const updates = { description, icon, isActive };
    if (name) {
      updates.name = name;
      updates.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    const category = await Category.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
    res.status(200).json({ success: true, message: 'Category updated', data: category });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
