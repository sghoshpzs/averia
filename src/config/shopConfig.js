// ============================================================================
// SHOP CONFIG — everything a shop owner needs to customize lives here.
// No other file should need to change when you add a category, vendor,
// dropdown option, or swap the logo.
// ============================================================================

const shopConfig = {
  shopName: 'Averia Jewellery',

  // Path or URL to the logo shown in the top nav. Put a file in /public/
  // (e.g. logo.png or logo.svg) and reference it as '/logo.png', or point
  // to a full https:// URL. A placeholder monogram ships at /logo.svg.
  logoPath: '/logo.png',

  currencySymbol: '\u20B9',

  // Firestore collection names used across the app.
  collections: {
    inventory: 'inventory',
    customers: 'customers',
    invoices: 'invoices',
    // Every individual sale event (one per unit sold) lives here, separate
    // from the inventory doc itself. This is what makes lot tracking work:
    // a lot doc is never overwritten with a single soldDate/soldPrice, each
    // sale gets its own permanent record instead. See "Lot tracking" below.
    sales: 'sales'
  },

  // ---- Categories -----------------------------------------------------
  // These are shown as options in the "Category" dropdown on Inventory,
  // Invoice, and the Summary filter. Every item is stored in a single
  // Firestore collection ("inventory") with a `category` field — this
  // array just drives the dropdown, it does not create new collections.
  categories: ['Necklace', 'Bracelet', 'Ring', 'Earring', 'Bangle', 'Anklet'],

  // ---- Lot tracking ------------------------------------------------------
  // Categories listed here skip individual barcodes. Instead of creating
  // one Firestore doc + one printed barcode per physical piece, Inventory
  // intake creates ONE doc for the whole batch with a `quantityPurchased`
  // count and ONE shared barcode. Invoice lookup then decrements
  // `quantityRemaining` per unit sold, and each sale writes its own record
  // to the `sales` collection (so per-sale date/price is never lost even
  // though many sales share one inventory doc). Good fit for small/cheap
  // items like rings and earrings where pasting a unique barcode on every
  // physical piece isn't practical. Leave a category out of this list to
  // keep the original one-barcode-per-piece behavior (better for higher
  // value pieces you want individually traceable, e.g. necklaces).
  lotTrackedCategories: ['Ring', 'Earring'],

  // ---- Type dropdown, scoped per category ------------------------------
  // Key = category name, Value = list of type options for that category.
  // Add a `_default` key to fall back on when a category isn't listed.
  types: {
    Necklace: ['AD', 'Kundan', 'Temple', 'Beaded', 'Chain'],
    Bracelet: ['Cuff', 'Chain', 'Beaded', 'Charm'],
    Ring: ['Solitaire', 'Band', 'Cocktail', 'Stackable'],
    Earring: ['Stud', 'Hoop', 'Jhumka', 'Danglers'],
    Bangle: ['Classic', 'Kada', 'Cuff'],
    Anklet: ['Chain', 'Beaded'],
    _default: ['General']
  },

  // ---- Vendors -----------------------------------------------------------
  vendors: [
    'Being Women Malaysian',
    'Rajwada Ethnic',
    'Sunrise Exports',
    'Local Artisan'
  ],

  // ---- Payment modes (Invoice page) --------------------------------------
  paymentModes: ['Cash', 'UPI', 'Card'],

  // ---- Defaults -----------------------------------------------------------
  defaults: {
    profitPercent: 100,
    boxPrice: 70.0,
    itemCount: 1
  },

  // ---- Inventory form field definitions ------------------------------------
  // type: 'category' | 'dropdown' | 'text' | 'number' | 'readonly'
  // 'dropdown' fields point to a `source` key that is resolved at runtime
  // (either a flat array in this config, or the per-category `types` map).
  inventoryFields: [
    { key: 'category', label: 'Category', type: 'category', required: true },
    { key: 'type', label: 'Type', type: 'dropdown', source: 'types', dependsOn: 'category', required: true },
    { key: 'vendor', label: 'Vendor', type: 'dropdown', source: 'vendors', required: true },
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'cost', label: 'Cost', type: 'number', min: 0, step: 0.01, required: true },
    { key: 'profitPercent', label: '% Profit', type: 'number', min: 0, step: 1, default: 'defaults.profitPercent' },
    { key: 'boxPrice', label: 'Box Price', type: 'number', min: 0, step: 0.01, default: 'defaults.boxPrice' },
    { key: 'printedPrice', label: 'Printed Price', type: 'readonly' },
    { key: 'itemCount', label: '# Items', type: 'number', min: 1, step: 1, default: 'defaults.itemCount' }
  ],

  // ---- Invoice form field definitions ---------------------------------
  invoiceFields: [
    { key: 'category', label: 'Category', type: 'category', required: true },
    { key: 'type', label: 'Type', type: 'dropdown', source: 'types', dependsOn: 'category', required: true },
    { key: 'barcode', label: 'Barcode', type: 'barcode', required: true },
    { key: 'printedPrice', label: 'Printed Price', type: 'lookupEditable' },
    { key: 'discountPercent', label: '% Discount', type: 'number', min: 0, max: 100, step: 1, default: 0 },
    { key: 'finalPrice', label: 'Final Price', type: 'readonly' }
  ],

  // ---- Inventory list columns (Summary page table) shown + filterable ----
  inventoryListColumns: [
    { key: 'rowId', label: 'Row ID', filter: 'text' },
    { key: 'sku', label: 'SKU', filter: 'text' },
    { key: 'category', label: 'Category', filter: 'select', source: 'categories' },
    { key: 'type', label: 'Type', filter: 'select', source: 'types' },
    { key: 'vendor', label: 'Vendor', filter: 'select', source: 'vendors' },
    { key: 'name', label: 'Name', filter: 'text', editable: true },
    { key: 'quantityPurchased', label: 'Qty', filter: 'number' },
    { key: 'quantityRemaining', label: 'Qty Left', filter: 'number' },
    { key: 'cost', label: 'Cost', filter: 'number' },
    { key: 'profitPercent', label: '% Profit', filter: 'number', editable: true },
    { key: 'boxPrice', label: 'Box Price', filter: 'number', editable: true },
    { key: 'printedPrice', label: 'Printed Price', filter: 'number' },
    { key: 'soldPrice', label: 'Sold Price', filter: 'number' },
    { key: 'profit', label: 'Profit', filter: 'number' },
    { key: 'status', label: 'Status', filter: 'select', source: 'statuses' },
    { key: 'created', label: 'Created', filter: 'date' },
    { key: 'soldDate', label: 'Sold Date', filter: 'date' }
  ],

  statuses: ['Purchased', 'Printed', 'Sold'],

  // ---- Twilio WhatsApp sandbox / production number, used only for display
  // in the UI (actual credentials live server-side in Cloud Functions env). --
  whatsappFromLabel: 'Shop WhatsApp (Twilio)'
};

export default shopConfig;

// Small helper: resolves a dot path like 'defaults.boxPrice' against config.
export function resolveDefault(path) {
  if (path === undefined) return undefined;
  return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), shopConfig);
}

// Resolves the option list for a dropdown field, given the current form values.
export function resolveDropdownSource(field, formValues) {
  if (field.source === 'types') {
    const category = formValues?.[field.dependsOn];
    return shopConfig.types[category] || shopConfig.types._default;
  }
  return shopConfig[field.source] || [];
}

export function isLotTracked(category) {
  return shopConfig.lotTrackedCategories.includes(category);
}
