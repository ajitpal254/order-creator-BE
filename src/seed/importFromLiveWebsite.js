import https from 'https';
import dotenv from 'dotenv';
import { connectDB } from '../config/db.js';
import { Product } from '../models/Product.js';
import { Category, Finish, Color, Brand, Size } from '../models/Attributes.js';

dotenv.config();

const fetchWithHeaders = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
};

export async function importLiveProducts() {
  console.log('[Live Import] Connecting to MongoDB...');
  await connectDB();

  console.log('[Live Import] Crawling haoverseas.com live website catalog...');
  const indexHtml = await fetchWithHeaders('https://haoverseas.com/');
  const rawMatches = indexHtml.match(/products\.php\?[^\s"'>]+/g) || [];
  const categoryUrls = [...new Set(rawMatches.map(u => u.replace(/&amp;/g, '&')))];

  console.log(`[Live Import] Found ${categoryUrls.length} category URLs.`);

  const scrapedProducts = [];
  const scrapedCategories = new Set();

  for (const relUrl of categoryUrls) {
    const fullUrl = `https://haoverseas.com/${relUrl}`;
    const urlObj = new URL(fullUrl);
    const categoryName = urlObj.searchParams.get('cname') || 'Hand Tools';
    const subcategoryName = urlObj.searchParams.get('sname') || '';

    scrapedCategories.add(categoryName);

    try {
      const pageHtml = await fetchWithHeaders(fullUrl);
      const proBoxRegex = /<div class="pro-box"[^>]*>[\s\S]*?<img[^>]+src="([^">]+)"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/gi;
      let match;

      while ((match = proBoxRegex.exec(pageHtml)) !== null) {
        const rawImg = match[1].trim();
        const rawTitle = match[2].replace(/<[^>]+>/g, '').trim();

        if (!rawTitle || rawTitle.toLowerCase().includes('dummy')) continue;

        const imageUrl = rawImg.startsWith('http') ? rawImg : `https://haoverseas.com/${rawImg.replace(/^\//, '')}`;
        const cleanName = rawTitle.replace(/\s+/g, ' ');

        scrapedProducts.push({
          rawTitle: cleanName,
          imageUrl,
          category: categoryName,
          subcategory: subcategoryName
        });
      }
    } catch (err) {
      console.error(`[Live Import] Failed on ${fullUrl}:`, err.message);
    }
  }

  // Deduplicate
  const uniqueMap = new Map();
  for (const item of scrapedProducts) {
    const key = `${item.rawTitle}_${item.imageUrl}`.toLowerCase();
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, item);
    }
  }

  const uniqueItems = Array.from(uniqueMap.values());
  console.log(`[Live Import] Extracted ${uniqueItems.length} unique tools from haoverseas.com.`);

  const finishes = (await Finish.find()).map(f => f.name);
  const colors = (await Color.find()).map(c => c.name);
  const brands = (await Brand.find()).map(b => b.name);
  const sizes = (await Size.find()).map(s => s.label);

  // Sync Categories
  for (const catName of scrapedCategories) {
    const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existingCat = await Category.findOne({ name: catName });
    if (!existingCat) {
      await Category.create({
        name: catName,
        slug,
        description: `Export grade industrial ${catName} conforming to DIN and ANSI international standards.`
      });
    }
  }

  let newCount = 0;
  let updatedCount = 0;

  for (let i = 0; i < uniqueItems.length; i++) {
    const item = uniqueItems[i];
    const prefix = item.category.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'TL');
    const sku = `HAO-${prefix}-${(i + 101).toString()}`;

    let basePrice = 4.50;
    let moq = 50;
    let weightKg = 0.65;
    let pcsPerCarton = 20;

    const catLower = item.category.toLowerCase();
    const titleLower = item.rawTitle.toLowerCase();

    if (catLower.includes('lubricant') || titleLower.includes('grease') || titleLower.includes('pump') || titleLower.includes('oiler')) {
      basePrice = 8.50;
      moq = 40;
      weightKg = 1.35;
      pcsPerCarton = 10;
    } else if (catLower.includes('vice') || titleLower.includes('vice') || titleLower.includes('anvil')) {
      basePrice = 32.00;
      moq = 15;
      weightKg = 8.50;
      pcsPerCarton = 1;
    } else if (catLower.includes('wrench') || titleLower.includes('wrench') || titleLower.includes('die')) {
      basePrice = 7.80;
      moq = 50;
      weightKg = 1.20;
      pcsPerCarton = 12;
    } else if (catLower.includes('plier') || titleLower.includes('plier') || catLower.includes('cutter')) {
      basePrice = 3.80;
      moq = 100;
      weightKg = 0.40;
      pcsPerCarton = 40;
    } else if (catLower.includes('spanner') || titleLower.includes('spanner')) {
      basePrice = 2.90;
      moq = 100;
      weightKg = 0.35;
      pcsPerCarton = 50;
    } else if (catLower.includes('hammer') || titleLower.includes('hammer')) {
      basePrice = 5.20;
      moq = 60;
      weightKg = 0.90;
      pcsPerCarton = 24;
    }

    const newProductData = {
      name: item.rawTitle,
      sku,
      category: item.category,
      description: `${item.rawTitle}. Precision drop forged and hardened tools by H.A. Overseas for professional industrial, automotive, and export engineering requirements.`,
      basePrice,
      currency: 'USD',
      moq,
      weightKg,
      pcsPerCarton,
      images: [item.imageUrl],
      allowedSizes: sizes.length > 0 ? sizes.slice(0, 6) : ['Standard'],
      allowedFinishes: finishes.length > 0 ? finishes : ['Chrome Plated (Mirror Polish)', 'Satin Matte Finish', 'Black Phosphate (Industrial)'],
      allowedColors: colors.length > 0 ? colors : ['Industrial Safety Red', 'Cobalt Blue', 'Tactical Matte Black'],
      allowedBrands: brands.length > 0 ? brands : ['H.A. Overseas (OEM Standard)', 'HA-PRO Heavy Duty', 'Custom Private Label (Buyer Brand)'],
      specifications: [
        { key: 'Manufacturer', value: 'H.A. Overseas (India)' },
        { key: 'Standard', value: 'DIN / ISO / ANSI Standard' },
        { key: 'Subcategory', value: item.subcategory || item.category },
      ],
      isActive: true,
    };

    const existing = await Product.findOne({
      $or: [{ name: item.rawTitle }, { images: item.imageUrl }]
    });

    if (existing) {
      existing.images = [item.imageUrl];
      existing.category = item.category;
      existing.name = item.rawTitle;
      await existing.save();
      updatedCount++;
    } else {
      await Product.create(newProductData);
      newCount++;
    }
  }

  console.log(`[Live Import Completed] Total: ${uniqueItems.length} | Added: ${newCount} | Synced: ${updatedCount}`);
  process.exit(0);
}

importLiveProducts().catch(err => {
  console.error('[Import Fatal Error]', err);
  process.exit(1);
});
