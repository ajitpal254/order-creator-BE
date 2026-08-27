import { User } from '../models/User.js';
import { Category, Finish, Color, Brand, Size } from '../models/Attributes.js';
import { Product } from '../models/Product.js';

export const seedDatabase = async () => {
  try {
    // 1. Seed Initial Admin User
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@haoverseas.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@Secure2026';

    const existingAdmin = await User.findOne({ 
      $or: [{ username: adminUsername }, { role: 'admin' }] 
    });

    if (!existingAdmin) {
      console.log(`[Seed] Initializing administrator account: ${adminUsername}`);
      const admin = new User({
        customerName: 'H.A. Overseas Admin',
        businessName: 'H.A. Overseas Corporation',
        country: 'India',
        phoneNumber: '+91 99884 65800',
        address: 'Jalandhar Industrial Cluster, Punjab, India',
        username: adminUsername,
        email: adminEmail,
        password: adminPassword,
        role: 'admin',
        isActive: true,
      });
      await admin.save();
      console.log('[Seed] Admin account initialized successfully.');
    } else {
      console.log(`[Seed] Admin user already exists.`);
    }

    // 2. Seed Default Finishes
    const defaultFinishes = [
      { name: 'Chrome Plated (Mirror Polish)', code: 'CP-MIRROR', description: 'High-gloss mirror chrome plating, maximum corrosion resistance' },
      { name: 'Satin Matte Finish', code: 'SAT-MATTE', description: 'Anti-slip micro-textured matte satin finish' },
      { name: 'Black Phosphate (Industrial)', code: 'BLK-PHOS', description: 'Heavy-duty black manganese phosphate coating' },
      { name: 'Powder Coated (High-Durability)', code: 'PWD-COAT', description: 'Electrostatic baked polyester powder coat' },
      { name: 'Zinc Plated (Yellow / Clear)', code: 'ZN-PLATE', description: 'Rust-inhibitive electro-galvanized zinc layer' },
      { name: 'Nickel Chrome Double Layer', code: 'NI-CR', description: 'Automotive grade nickel and chrome plating' },
    ];

    for (const f of defaultFinishes) {
      const exists = await Finish.findOne({ name: f.name });
      if (!exists) await Finish.create(f);
    }

    // 3. Seed Default Colors
    const defaultColors = [
      { name: 'Industrial Safety Red', hexCode: '#DC2626', description: 'Standard high-visibility red' },
      { name: 'Cobalt Blue', hexCode: '#2563EB', description: 'Deep industrial engineering blue' },
      { name: 'Tactical Matte Black', hexCode: '#18181B', description: 'Anti-glare industrial black' },
      { name: 'Safety Yellow', hexCode: '#EAB308', description: 'High-visibility workshop safety yellow' },
      { name: 'Silver Metallic', hexCode: '#94A3B8', description: 'Classic polished steel finish' },
      { name: 'Forest Green', hexCode: '#16A34A', description: 'Heavy agricultural green' },
      { name: 'Titanium Gunmetal', hexCode: '#475569', description: 'Premium gunmetal grey' },
    ];

    for (const c of defaultColors) {
      const exists = await Color.findOne({ name: c.name });
      if (!exists) await Color.create(c);
    }

    // 4. Seed Default Brands
    const defaultBrands = [
      { name: 'GENSTAR (H.A. Standard)', isCustom: false, description: 'Primary manufacturer brand marking by H.A. Overseas' },
      { name: 'H.A. Overseas (OEM Standard)', isCustom: false, description: 'Direct factory export brand' },
      { name: 'HA-PRO Heavy Duty', isCustom: false, description: 'Professional grade high-torque tool line' },
      { name: 'Custom Private Label (Buyer Brand)', isCustom: true, description: 'Laser engraved or stamped buyer brand on export batches' },
    ];

    for (const b of defaultBrands) {
      const exists = await Brand.findOne({ name: b.name });
      if (!exists) await Brand.create(b);
    }

    // 5. Seed Default Sizes
    const defaultSizes = [
      { label: '500 cc / 16 oz (Grease Gun)', unit: 'cc', categoryType: 'Grease Guns' },
      { label: '1000 cc / 32 oz (Heavy Gun)', unit: 'cc', categoryType: 'Grease Guns' },
      { label: '400 cc Cartridge Type', unit: 'cc', categoryType: 'Grease Guns' },
      { label: '6 Inch (150mm)', unit: 'inch', categoryType: 'Pliers/Spanners' },
      { label: '8 Inch (200mm)', unit: 'inch', categoryType: 'Pliers/Spanners' },
      { label: '10 Inch (250mm)', unit: 'inch', categoryType: 'Pliers/Spanners' },
      { label: '12 Inch (300mm)', unit: 'inch', categoryType: 'Pliers/Spanners' },
      { label: '14 Inch (350mm)', unit: 'inch', categoryType: 'Pipe Tools' },
      { label: '18 Inch (450mm)', unit: 'inch', categoryType: 'Pipe Tools' },
      { label: '24 Inch (600mm)', unit: 'inch', categoryType: 'Pipe Tools' },
      { label: '6mm - 32mm (Set of 12 pcs)', unit: 'Set', categoryType: 'Spanner Sets' },
      { label: '1/4" & 1/2" Drive Socket Set (46 pcs)', unit: 'Set', categoryType: 'Sockets' },
    ];

    for (const s of defaultSizes) {
      const exists = await Size.findOne({ label: s.label });
      if (!exists) await Size.create(s);
    }

    // 6. Seed Default Categories
    const defaultCategories = [
      { name: 'Spanners & Wrenches', slug: 'spanners-wrenches', description: 'Double open end spanners, combination spanners, ring spanners and adjustable wrenches.' },
      { name: 'Grease Guns & Lubrication', slug: 'grease-guns-lubrication', description: 'Heavy duty lever type, pistol grip, suction guns, barrel pumps and oilers.' },
      { name: 'Sockets & Drive Accessories', slug: 'sockets-accessories', description: 'Chrome vanadium metric & SAE sockets, ratchet handles, extensions, and master tool sets.' },
      { name: 'Pliers & Cutters', slug: 'pliers-cutters', description: 'Combination pliers, long nose pliers, water pump pliers, and side cutters.' },
      { name: 'Pipe Tools & Vices', slug: 'pipe-tools-vices', description: 'All-steel bench vices, ductile cast iron vices, pipe wrenches and ratchet pipe die sets.' },
      { name: 'Striking & Chisels', slug: 'striking-chisels', description: 'Machinist ball pein hammers, cold chisels, and center punches.' },
    ];

    for (const cat of defaultCategories) {
      const exists = await Category.findOne({ slug: cat.slug });
      if (!exists) await Category.create(cat);
    }

    // 7. Seed Official H.A. Overseas Catalog with Authentic Live Images
    const officialCatalog = [
      // 1. Spanners
      {
        name: 'GENSTAR124 Double Open End Spanner (Press Pattern)',
        sku: 'HAO-SPN-124',
        category: 'Spanners & Wrenches',
        description: 'Drop forged Carbon / Chrome Vanadium steel double open end spanner with precision broached open jaws. Conforms to DIN 3110 / ISO 1085 specifications.',
        basePrice: 2.80,
        currency: 'USD',
        moq: 100,
        weightKg: 0.35,
        pcsPerCarton: 50,
        images: ['https://haoverseas.com/img-products/spann-1.jpg'],
        allowedSizes: ['6mm - 32mm (Set of 12 pcs)', '6 Inch (150mm)', '8 Inch (200mm)', '10 Inch (250mm)'],
        allowedFinishes: ['Chrome Plated (Mirror Polish)', 'Satin Matte Finish', 'Nickel Chrome Double Layer', 'Zinc Plated (Yellow / Clear)'],
        allowedColors: ['Silver Metallic'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)', 'Custom Private Label (Buyer Brand)'],
        specifications: [
          { key: 'Standard', value: 'DIN 3110 / ISO 1085' },
          { key: 'Material', value: 'Drop Forged Chrome Vanadium (Cr-V) / Carbon Steel' },
          { key: 'Surface Treatment', value: 'Hardened & Tempered to 44-48 HRC' },
        ],
      },
      {
        name: 'GENSTAR100 Recessed Panel Double Open End Spanner',
        sku: 'HAO-SPN-100',
        category: 'Spanners & Wrenches',
        description: 'Recessed panel design engineered for reduced weight and improved torque distribution. Precision machined jaw profile for tight fastener grip.',
        basePrice: 3.10,
        currency: 'USD',
        moq: 100,
        weightKg: 0.38,
        pcsPerCarton: 50,
        images: ['https://haoverseas.com/img-products/301(1).jpg'],
        allowedSizes: ['6mm - 32mm (Set of 12 pcs)', '6 Inch (150mm)', '8 Inch (200mm)', '10 Inch (250mm)'],
        allowedFinishes: ['Chrome Plated (Mirror Polish)', 'Satin Matte Finish', 'Black Phosphate (Industrial)'],
        allowedColors: ['Silver Metallic'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)', 'Custom Private Label (Buyer Brand)'],
        specifications: [
          { key: 'Standard', value: 'DIN 3110' },
          { key: 'Head Angle', value: '15° Angle for Knuckle Clearance' },
          { key: 'Origin', value: 'H.A. Overseas (India)' },
        ],
      },
      {
        name: 'GENSTAR107 Combination Spanner (Raised Panel DIN 3113)',
        sku: 'HAO-SPN-107',
        category: 'Spanners & Wrenches',
        description: 'Heavy duty drop forged Cr-V combination spanner. Features a 15-degree open jaw and a 12-point offset bi-hexagonal ring head for maximum contact on high-torque bolts.',
        basePrice: 3.40,
        currency: 'USD',
        moq: 100,
        weightKg: 0.42,
        pcsPerCarton: 40,
        images: ['https://haoverseas.com/img-products/com-span.jpg'],
        allowedSizes: ['6mm - 32mm (Set of 12 pcs)', '8 Inch (200mm)', '10 Inch (250mm)', '12 Inch (300mm)'],
        allowedFinishes: ['Chrome Plated (Mirror Polish)', 'Satin Matte Finish', 'Nickel Chrome Double Layer'],
        allowedColors: ['Silver Metallic'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)', 'Custom Private Label (Buyer Brand)'],
        specifications: [
          { key: 'Standard', value: 'DIN 3113 / ISO 7738' },
          { key: 'Ring End', value: '12-Point MaxiDrive Profile' },
          { key: 'Hardness', value: '45 - 50 HRC' },
        ],
      },
      {
        name: 'GENSTAR111 Bi-Hexagonal Deep Offset Ring Spanner',
        sku: 'HAO-SPN-111',
        category: 'Spanners & Wrenches',
        description: '75-degree deep offset double ring spanner for recessed bolts in automotive engine bays and agricultural machinery.',
        basePrice: 4.20,
        currency: 'USD',
        moq: 80,
        weightKg: 0.48,
        pcsPerCarton: 30,
        images: ['https://haoverseas.com/img-products/111.jpg'],
        allowedSizes: ['6mm - 32mm (Set of 12 pcs)', '8 Inch (200mm)', '10 Inch (250mm)'],
        allowedFinishes: ['Chrome Plated (Mirror Polish)', 'Satin Matte Finish'],
        allowedColors: ['Silver Metallic'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'HA-PRO Heavy Duty'],
        specifications: [
          { key: 'Standard', value: 'DIN 838 / ISO 3318' },
          { key: 'Offset Angle', value: '75° Deep Crank' },
        ],
      },

      // 2. Grease Guns & Lubrication Equipment
      {
        name: 'GENSTAR Heavy-Duty Lever Type Grease Gun (10,000 PSI)',
        sku: 'HAO-GG-122',
        category: 'Grease Guns & Lubrication',
        description: 'High-pressure cast iron head with ergonomic rubber grip lever. Suitable for 500cc bulk grease or 400g standard cartridges. Heavy-duty follower spring with air release bleeder valve.',
        basePrice: 8.50,
        currency: 'USD',
        moq: 50,
        weightKg: 1.45,
        pcsPerCarton: 10,
        images: ['https://haoverseas.com/img-products/122.jpg'],
        allowedSizes: ['500 cc / 16 oz (Grease Gun)', '1000 cc / 32 oz (Heavy Gun)', '400 cc Cartridge Type'],
        allowedFinishes: ['Powder Coated (High-Durability)', 'Chrome Plated (Mirror Polish)', 'Zinc Plated (Yellow / Clear)'],
        allowedColors: ['Industrial Safety Red', 'Cobalt Blue', 'Tactical Matte Black', 'Safety Yellow', 'Forest Green'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)', 'Custom Private Label (Buyer Brand)'],
        specifications: [
          { key: 'Working Pressure', value: '6,000 - 10,000 PSI' },
          { key: 'Barrel Material', value: 'Seamless High-Strength Steel Tube 1.2mm' },
          { key: 'Nozzle Type', value: '4-Jaw Hardened Grease Coupler + Rigid Steel Pipe' },
          { key: 'Loading Methods', value: 'Cartridge / Bulk / Suction' },
        ],
      },
      {
        name: 'GENSTAR One-Handed Pistol Grip Grease Gun (8,000 PSI)',
        sku: 'HAO-GG-123',
        category: 'Grease Guns & Lubrication',
        description: 'Compact pistol design engineered for tight access lubrication points in automotive and agricultural machinery. Variable stroke mechanism with aluminum die-cast head.',
        basePrice: 7.20,
        currency: 'USD',
        moq: 50,
        weightKg: 1.15,
        pcsPerCarton: 12,
        images: ['https://haoverseas.com/img-products/123.jpg'],
        allowedSizes: ['400 cc Cartridge Type', '500 cc / 16 oz (Grease Gun)'],
        allowedFinishes: ['Powder Coated (High-Durability)', 'Black Phosphate (Industrial)'],
        allowedColors: ['Cobalt Blue', 'Industrial Safety Red', 'Tactical Matte Black', 'Safety Yellow'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'HA-PRO Heavy Duty', 'Custom Private Label (Buyer Brand)'],
        specifications: [
          { key: 'Max Pressure', value: '8,000 PSI' },
          { key: 'Grip Style', value: 'Heavy Duty Contoured Pistol Grip' },
          { key: 'Included Hose', value: '12" High-Pressure Flexible Reinforced Hose' },
        ],
      },
      {
        name: 'GENSTAR Heavy Duty Industrial Suction Gun (500cc)',
        sku: 'HAO-LUB-106',
        category: 'Grease Guns & Lubrication',
        description: 'Heavy duty suction gun for draining and filling gearboxes, differentials, transmissions and sumps with non-corrosive liquids.',
        basePrice: 5.80,
        currency: 'USD',
        moq: 50,
        weightKg: 0.85,
        pcsPerCarton: 20,
        images: ['https://haoverseas.com/img-products/106.jpg'],
        allowedSizes: ['500 cc / 16 oz (Grease Gun)', '1000 cc / 32 oz (Heavy Gun)'],
        allowedFinishes: ['Powder Coated (High-Durability)', 'Zinc Plated (Yellow / Clear)'],
        allowedColors: ['Cobalt Blue', 'Industrial Safety Red', 'Tactical Matte Black'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)'],
        specifications: [
          { key: 'Capacity', value: '500cc / 16 oz' },
          { key: 'Hose', value: '12" Clear Flexible Vinyl Hose' },
        ],
      },
      {
        name: 'GENSTAR Rotary Heavy Duty Barrel Drum Pump',
        sku: 'HAO-LUB-113',
        category: 'Grease Guns & Lubrication',
        description: 'Cast iron rotary hand pump for transferring diesel, lubricating oils, kerosene and non-corrosive media from 55-gallon drums.',
        basePrice: 16.50,
        currency: 'USD',
        moq: 20,
        weightKg: 4.20,
        pcsPerCarton: 4,
        images: ['https://haoverseas.com/img-products/113.jpg'],
        allowedSizes: ['Standard'],
        allowedFinishes: ['Powder Coated (High-Durability)', 'Zinc Plated (Yellow / Clear)'],
        allowedColors: ['Industrial Safety Red', 'Cobalt Blue'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)'],
        specifications: [
          { key: 'Flow Rate', value: '5 Litres per 20 Turns' },
          { key: 'Fitment', value: '2" BSP/NPT Bung Adapter for 15-55 Gallon Drums' },
        ],
      },

      // 3. Sockets & Accessories
      {
        name: 'GENSTAR124 1/2" Drive Heavy Duty Socket Set (Cr-V Steel)',
        sku: 'HAO-SCK-124',
        category: 'Sockets & Drive Accessories',
        description: 'Complete 24-piece master socket set made from cold forged Chrome Vanadium steel with quick-release 72-teeth ratchet and steel carrying case.',
        basePrice: 22.00,
        currency: 'USD',
        moq: 30,
        weightKg: 3.80,
        pcsPerCarton: 4,
        images: ['https://haoverseas.com/img-products/124.jpg'],
        allowedSizes: ['1/4" & 1/2" Drive Socket Set (46 pcs)', 'Standard'],
        allowedFinishes: ['Chrome Plated (Mirror Polish)', 'Satin Matte Finish'],
        allowedColors: ['Silver Metallic'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'HA-PRO Heavy Duty', 'Custom Private Label (Buyer Brand)'],
        specifications: [
          { key: 'Drive Size', value: '1/2" Square Drive' },
          { key: 'Socket Range', value: '10mm - 32mm Metric 6-Point' },
          { key: 'Case', value: 'Heavy Gauge Metal Box with Fitted Foam' },
        ],
      },
      {
        name: 'GENSTAR125 1/4" & 1/2" Drive Master Socket Box Set',
        sku: 'HAO-SCK-125',
        category: 'Sockets & Drive Accessories',
        description: 'Comprehensive multi-drive mechanic tool kit with deep sockets, extension bars, universal joints, and bit adapters.',
        basePrice: 28.50,
        currency: 'USD',
        moq: 20,
        weightKg: 4.90,
        pcsPerCarton: 4,
        images: ['https://haoverseas.com/img-products/125(1).jpg'],
        allowedSizes: ['1/4" & 1/2" Drive Socket Set (46 pcs)'],
        allowedFinishes: ['Chrome Plated (Mirror Polish)', 'Satin Matte Finish'],
        allowedColors: ['Silver Metallic'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)'],
        specifications: [
          { key: 'Components', value: '46 Pieces Master Assortment' },
          { key: 'Ratchet Teeth', value: '72 Teeth Fine Gear Mechanism' },
        ],
      },

      // 4. Pliers & Cutters
      {
        name: 'GENSTAR Heavy Duty Combination Pliers with Soft Grip',
        sku: 'HAO-PL-130',
        category: 'Pliers & Cutters',
        description: 'High-leverage design providing 35% less effort. Precision induction hardened cutting edges (60 HRC) for piano and hard wire. Ergonomic dual-component TPR insulated handles.',
        basePrice: 3.40,
        currency: 'USD',
        moq: 100,
        weightKg: 0.38,
        pcsPerCarton: 60,
        images: ['https://haoverseas.com/img-products/130.jpg'],
        allowedSizes: ['6 Inch (150mm)', '8 Inch (200mm)', '10 Inch (250mm)'],
        allowedFinishes: ['Satin Matte Finish', 'Black Phosphate (Industrial)', 'Chrome Plated (Mirror Polish)'],
        allowedColors: ['Industrial Safety Red', 'Cobalt Blue', 'Safety Yellow', 'Forest Green'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'HA-PRO Heavy Duty', 'Custom Private Label (Buyer Brand)'],
        specifications: [
          { key: 'Standard', value: 'DIN ISO 5746' },
          { key: 'Cutting Capacity', value: 'Piano wire 2.2mm, Hard wire 2.8mm' },
          { key: 'Handle', value: 'Heavy Duty TPR Dual Injection Grip' },
        ],
      },
      {
        name: 'GENSTAR High Leverage Long Nose Pliers',
        sku: 'HAO-PL-131',
        category: 'Pliers & Cutters',
        description: 'Serrated gripping jaws with side cutting edge for bending and precision assembly in tight electrical enclosures.',
        basePrice: 3.20,
        currency: 'USD',
        moq: 100,
        weightKg: 0.28,
        pcsPerCarton: 60,
        images: ['https://haoverseas.com/img-products/131L.jpg'],
        allowedSizes: ['6 Inch (150mm)', '8 Inch (200mm)'],
        allowedFinishes: ['Satin Matte Finish', 'Nickel Chrome Double Layer', 'Black Phosphate (Industrial)'],
        allowedColors: ['Cobalt Blue', 'Industrial Safety Red'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'HA-PRO Heavy Duty'],
        specifications: [
          { key: 'Standard', value: 'DIN ISO 5745' },
          { key: 'Jaw Type', value: 'Half-Round Serrated Jaws' },
        ],
      },
      {
        name: 'GENSTAR Box-Joint Water Pump Pliers (Groove Joint)',
        sku: 'HAO-PL-115',
        category: 'Pliers & Cutters',
        description: 'Double-groove interlocking joint water pump pliers with induction hardened self-locking teeth for pipes and hex nuts.',
        basePrice: 4.10,
        currency: 'USD',
        moq: 80,
        weightKg: 0.45,
        pcsPerCarton: 36,
        images: ['https://haoverseas.com/img-products/115.jpg'],
        allowedSizes: ['8 Inch (200mm)', '10 Inch (250mm)', '12 Inch (300mm)'],
        allowedFinishes: ['Black Phosphate (Industrial)', 'Powder Coated (High-Durability)'],
        allowedColors: ['Cobalt Blue', 'Industrial Safety Red', 'Tactical Matte Black'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)'],
        specifications: [
          { key: 'Standard', value: 'DIN ISO 8976' },
          { key: 'Jaw Positions', value: '7 Adjustable Positions' },
        ],
      },

      // 5. Pipe Tools & Vices
      {
        name: 'GENSTAR Professional All-Steel Bench Vice with Swivel Base',
        sku: 'HAO-VC-118',
        category: 'Pipe Tools & Vices',
        description: 'Unbreakable drop forged steel body with 360-degree lockable swivel base and integrated anvil. Serrated hardened jaws for ultimate workpiece clamping force.',
        basePrice: 34.00,
        currency: 'USD',
        moq: 20,
        weightKg: 9.50,
        pcsPerCarton: 1,
        images: ['https://haoverseas.com/img-products/118.jpg'],
        allowedSizes: ['6 Inch (150mm)', '8 Inch (200mm)'],
        allowedFinishes: ['Powder Coated (High-Durability)', 'Black Phosphate (Industrial)'],
        allowedColors: ['Cobalt Blue', 'Tactical Matte Black', 'Industrial Safety Red'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'HA-PRO Heavy Duty'],
        specifications: [
          { key: 'Clamping Force', value: '3,000 kgf' },
          { key: 'Jaw Width', value: '150mm (6")' },
          { key: 'Max Opening', value: '175mm' },
          { key: 'Base Type', value: '360° Dual Lock Swivel' },
        ],
      },
      {
        name: 'GENSTAR Heavy Duty Ductile Cast Iron Bench Vice',
        sku: 'HAO-VC-119',
        category: 'Pipe Tools & Vices',
        description: 'High tensile ductile SG iron construction with precision rolled acme steel screw and replaceable Cr-Mo steel jaws.',
        basePrice: 28.00,
        currency: 'USD',
        moq: 20,
        weightKg: 8.20,
        pcsPerCarton: 1,
        images: ['https://haoverseas.com/img-products/119.jpg'],
        allowedSizes: ['6 Inch (150mm)', '8 Inch (200mm)'],
        allowedFinishes: ['Powder Coated (High-Durability)'],
        allowedColors: ['Cobalt Blue', 'Forest Green', 'Tactical Matte Black'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)'],
        specifications: [
          { key: 'Material', value: 'Ductile SG Iron Body (SG 500/7)' },
          { key: 'Spindle', value: 'High Grade Carbon Steel Acme Thread' },
        ],
      },
      {
        name: 'GENSTAR Heavy Duty Stillson Pattern Pipe Wrench',
        sku: 'HAO-PW-120',
        category: 'Pipe Tools & Vices',
        description: 'High-grade ductile iron body with induction hardened replaceable Cr-Mo steel jaws. Self-cleaning threads and floating hook jaw for instant pipe grip.',
        basePrice: 6.80,
        currency: 'USD',
        moq: 60,
        weightKg: 1.60,
        pcsPerCarton: 10,
        images: ['https://haoverseas.com/img-products/120.jpg'],
        allowedSizes: ['10 Inch (250mm)', '12 Inch (300mm)', '14 Inch (350mm)', '18 Inch (450mm)', '24 Inch (600mm)'],
        allowedFinishes: ['Powder Coated (High-Durability)', 'Black Phosphate (Industrial)'],
        allowedColors: ['Industrial Safety Red', 'Cobalt Blue', 'Safety Yellow', 'Tactical Matte Black'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'HA-PRO Heavy Duty', 'Custom Private Label (Buyer Brand)'],
        specifications: [
          { key: 'Jaw Capacity', value: 'Up to 2" (50mm) Outer Diameter' },
          { key: 'Body Material', value: 'Heavy Ductile Cast Iron' },
          { key: 'Jaw Material', value: 'Drop Forged Alloy Steel, Induction Hardened 55-60 HRC' },
        ],
      },

      // 6. Striking Tools & Clamps
      {
        name: 'GENSTAR Drop Forged Machinist Ball Pein Hammer',
        sku: 'HAO-HMR-117',
        category: 'Striking & Chisels',
        description: 'Drop forged high carbon steel hammer head with induction hardened striking face and pein. Fitted with ergonomic fiberglass or seasoned hickory wood handle.',
        basePrice: 4.80,
        currency: 'USD',
        moq: 60,
        weightKg: 0.80,
        pcsPerCarton: 24,
        images: ['https://haoverseas.com/img-products/117.jpg'],
        allowedSizes: ['Standard'],
        allowedFinishes: ['Black Phosphate (Industrial)', 'Powder Coated (High-Durability)'],
        allowedColors: ['Tactical Matte Black', 'Industrial Safety Red'],
        allowedBrands: ['GENSTAR (H.A. Standard)', 'H.A. Overseas (OEM Standard)'],
        specifications: [
          { key: 'Head Weight', value: '16 oz / 24 oz / 32 oz' },
          { key: 'Handle', value: 'Shock-Absorbing TPR Fiberglass' },
        ],
      },
    ];

    // Upsert or insert all products
    for (const prod of officialCatalog) {
      const existing = await Product.findOne({ sku: prod.sku });
      if (existing) {
        Object.assign(existing, prod);
        await existing.save();
      } else {
        await Product.create(prod);
      }
    }

    console.log(`[Seed] Synced ${officialCatalog.length} official products with authentic photos from haoverseas.com.`);
    console.log('[Seed] Database initialization completed.');
  } catch (error) {
    console.error('[Seed Error] Failed to seed database:', error.message);
  }
};
