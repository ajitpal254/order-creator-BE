import { Product } from '../models/Product.js';

// @desc Get all products with filters
// @route GET /api/products
export const getProducts = async (req, res) => {
  try {
    const { category, brand, finish, search, limit = 100, page = 1 } = req.query;
    const filter = { 
      isActive: true,
      sku: { $exists: true, $ne: null }
    };

    if (category && category !== 'All') {
      filter.category = category;
    }
    if (brand && brand !== 'All') {
      filter.allowedBrands = brand;
    }
    if (finish && finish !== 'All') {
      filter.allowedFinishes = finish;
    }
    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { sku: searchRegex },
        { description: searchRegex },
        { category: searchRegex },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Product.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: products,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get single product
// @route GET /api/products/:id
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Create a new product (Admin)
// @route POST /api/products
export const createProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      category,
      description,
      basePrice,
      currency,
      moq,
      weightKg,
      pcsPerCarton,
      allowedSizes,
      allowedFinishes,
      allowedColors,
      allowedBrands,
      specifications,
      images,
    } = req.body;

    if (!name || !sku || !category) {
      return res.status(400).json({
        success: false,
        message: 'Product Name, SKU, and Category are mandatory.',
      });
    }

    const existing = await Product.findOne({ sku: sku.toUpperCase().trim() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Product SKU "${sku}" already exists.`,
      });
    }

    // Process uploaded files if any
    let finalImages = Array.isArray(images) ? [...images] : [];
    if (req.files && req.files.length > 0) {
      const uploadedUrls = req.files.map((file) => `/uploads/${file.filename}`);
      finalImages = [...finalImages, ...uploadedUrls];
    }

    // Parse array/JSON fields if sent via FormData
    const parseField = (val) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val);
        } catch {
          return val.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      return val || [];
    };

    const product = new Product({
      name: name.trim(),
      sku: sku.toUpperCase().trim(),
      category: category.trim(),
      description: description || '',
      basePrice: Number(basePrice) || 0,
      currency: currency || 'USD',
      moq: Number(moq) || 50,
      weightKg: Number(weightKg) || 1,
      pcsPerCarton: Number(pcsPerCarton) || 20,
      allowedSizes: parseField(allowedSizes),
      allowedFinishes: parseField(allowedFinishes),
      allowedColors: parseField(allowedColors),
      allowedBrands: parseField(allowedBrands),
      specifications: parseField(specifications),
      images: finalImages.length > 0 ? finalImages : ['https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=80'],
    });

    await product.save();

    return res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Update product (Admin)
// @route PUT /api/products/:id
export const updateProduct = async (req, res) => {
  try {
    const parseField = (val) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val);
        } catch {
          return val.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      return val;
    };

    const updates = { ...req.body };
    if (updates.allowedSizes) updates.allowedSizes = parseField(updates.allowedSizes);
    if (updates.allowedFinishes) updates.allowedFinishes = parseField(updates.allowedFinishes);
    if (updates.allowedColors) updates.allowedColors = parseField(updates.allowedColors);
    if (updates.allowedBrands) updates.allowedBrands = parseField(updates.allowedBrands);
    if (updates.specifications) updates.specifications = parseField(updates.specifications);

    if (req.files && req.files.length > 0) {
      const uploadedUrls = req.files.map((file) => `/uploads/${file.filename}`);
      let existingImages = updates.images ? (Array.isArray(updates.images) ? updates.images : [updates.images]) : [];
      updates.images = [...existingImages, ...uploadedUrls];
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: product,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Delete product (Admin)
// @route DELETE /api/products/:id
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.status(200).json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Upload image standalone
// @route POST /api/products/upload-image
export const uploadImage = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image uploaded.' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  return res.status(200).json({
    success: true,
    url: fileUrl,
  });
};
