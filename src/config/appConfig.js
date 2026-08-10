/**
 * ============================================================================
 * CENTRAL APP CONFIG
 * ============================================================================
 * Everything the shop owner needs to change - logo, categories (Firestore
 * collections, i.e. your "sheet tabs"), dropdown option lists, and the field
 * definitions that drive the Inventory & Invoice forms - lives here.
 *
 * Nothing in the page components is hard-coded to a specific field name,
 * so adding/removing a field, changing a dropdown list, or adding a new
 * jewellery category only ever means editing THIS file.
 * ============================================================================
 */

const appConfig = {
  // ---------------------------------------------------------------------
  // BRANDING
  // ---------------------------------------------------------------------
  brand: {
    shopName: "Aurelia Fine Jewellery",
    // Local path (public/assets/logo.png) OR a full Firebase Storage /
    // remote URL both work here - whatever you put, <Logo /> just renders it.
    logoPath: "/assets/logo.png",
    logoAlt: "Aurelia Fine Jewellery",
  },

  // ---------------------------------------------------------------------
  // CATEGORIES == Firestore collection names (your "sheet tabs")
  // Each category becomes its own collection, e.g. Necklace, Bracelet ...
  // ---------------------------------------------------------------------
  categories: ["Necklace", "Bracelet", "Ring", "Earring", "Bangle", "Pendant"],

  // ---------------------------------------------------------------------
  // REUSABLE DROPDOWN SOURCES
  // Referenced from field configs below via "source": "dropdowns.type"
  // ---------------------------------------------------------------------
  dropdowns: {
    type: ["AD", "Gold Plated", "Silver", "Diamond", "Kundan", "Pearl", "Polki"],
    vendor: [
      "Being Women Malaysian",
      "Rajesh Exports",
      "Kundan Creations",
      "Silver Studio",
      "Local Artisan",
    ],
  },

  // ---------------------------------------------------------------------
  // INVENTORY PAGE FIELDS
  // type: "select" | "text" | "number" | "readonly"
  // source: dotted path into this config object (categories / dropdowns.x)
  // formula: name of a function in src/utils/formulas.js used to compute
  //          a readonly field's live value from the rest of the form state
  // ---------------------------------------------------------------------
  inventoryFields: [
    {
      name: "category",
      label: "Category",
      type: "select",
      source: "categories",
      required: true,
      helpText: "Also the sheet/tab this record is saved into",
    },
    { name: "type", label: "Type", type: "select", source: "dropdowns.type", required: true },
    { name: "vendor", label: "Vendor", type: "select", source: "dropdowns.vendor", required: true },
    { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Necklace" },
    { name: "cost", label: "Cost", type: "number", required: true, min: 0, step: "0.01", prefix: "₹" },
    { name: "profitPct", label: "% Profit", type: "number", default: 100, min: 0, step: "1" },
    { name: "boxPrice", label: "Box Price", type: "number", default: 70.0, min: 0, step: "0.01", prefix: "₹" },
    {
      name: "printedPrice",
      label: "Printed Price",
      type: "readonly",
      formula: "computePrintedPrice",
      prefix: "₹",
      helpText: "(Cost + Cost × %Profit) + Box Price",
    },
    {
      name: "itemCount",
      label: "# Items",
      type: "number",
      default: 1,
      min: 1,
      step: "1",
      helpText: "Creates this many identical records (bulk entry)",
    },
  ],

  // ---------------------------------------------------------------------
  // INVOICE PAGE FIELDS
  // ---------------------------------------------------------------------
  invoiceFields: [
    { name: "category", label: "Category", type: "select", source: "categories", required: true },
    { name: "type", label: "Type", type: "select", source: "dropdowns.type", required: true },
    {
      name: "barcode",
      label: "Barcode (Row ID)",
      type: "barcode",
      required: true,
      helpText: "Scan with camera or type the 8-digit Row ID",
    },
    {
      name: "printedPrice",
      label: "Printed Price",
      type: "number",
      prefix: "₹",
      helpText: "Auto-filled from inventory lookup; editable if lookup fails",
    },
    { name: "discountPct", label: "% Discount", type: "number", default: 0, min: 0, max: 100, step: "1" },
    {
      name: "finalPrice",
      label: "Final Price",
      type: "readonly",
      formula: "computeFinalPrice",
      prefix: "₹",
      helpText: "Printed Price − %Discount",
    },
  ],

  // ---------------------------------------------------------------------
  // MISC
  // ---------------------------------------------------------------------
  currencySymbol: "₹",
  defaultStatus: "Purchased",
  soldStatus: "Sold",
};

export default appConfig;
