const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const InventorySchema = new mongoose.Schema(
  {
    inventory_id: { type: String, default: randomUUID },
    inventory_barcode: { type: String },
    inventory_general: {
      width: { type: Number },
      depth: { type: Number },
      height: { type: Number },
      weight: { type: Number },
      seven_day_price: { type: Number },
      seven_day_visible: { type: Boolean, default: false },
      three_day_price: { type: Number },
      three_day_visible: { type: Boolean, default: false },
    },
  },
  {
    timestamps: {
      createdAt: "inventory_created_at",
      updatedAt: "inventory_updated_at",
    },
  }
);

module.exports = mongoose.model("Inventory", InventorySchema);
