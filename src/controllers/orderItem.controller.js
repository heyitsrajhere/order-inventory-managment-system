const Order = require("../schemas/order.schema");
const Inventory = require("../schemas/inventory.schema");
const OrderItem = require("../schemas/orderItem.schema");
const { getStatus } = require("../helper/orderItem");

let createOrderItem = async (req, res) => {
  try {
    let { oi_inventory_fk_inventory_id, oi_order_fk_order_id } = req.body;
    // IT WILL CHECK IF THE ORDER ITEM ALREADY EXISTS.
    let existingOrderItem = await OrderItem.findOne({
      oi_inventory_fk_inventory_id,
      oi_order_fk_order_id,
    });
    // console.log(existingOrderItem);
    if (existingOrderItem) {
      return res.status(400).json({
        error: "This inventory is already added to the order",
      });
    }

    // IT WILL FIND THE ORDER IN ORDER COLLECTION.
    let order = await Order.findOne({ order_id: oi_order_fk_order_id });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // IT WILL GET THE STATUS AND UNAVAILABLE UNTIL.
    let { status, unavailableUntil } = await getStatus(
      order,
      oi_inventory_fk_inventory_id,
      oi_order_fk_order_id
    );

    // IT WILL CREATE A NEW ORDER ITEM.
    let newOrderItem = new OrderItem({
      ...req.body,
      oi_pickup_at: order.order_pickup_at,
      oi_return_at: order.order_return_at,
      oi_status: status,
      oi_unavailable_until: unavailableUntil,
    });

    await newOrderItem.save();

    // IT WILL UPDATE THE ORDER IN ORDER COLLECTION.
    await Order.updateOne(
      { order_id: oi_order_fk_order_id },
      { order_request_hold: false }
    );
    // console.log(newOrderItem);
    res.status(201).json(newOrderItem);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

let deleteOrderItem = async (req, res) => {
  try {
    let { oi_id } = req.params;
    // IT WILL FIND THE ORDER ITEM IN ORDER ITEM COLLECTION.
    let orderItem = await OrderItem.findOne({ oi_id });
    if (!orderItem) {
      return res.status(404).json({ error: "Order item not found" });
    }

    // IT WILL SOFT DELETE AND CANCEL THE ITEM.
    orderItem.oi_deleted = true;
    orderItem.oi_status = "cancelled";
    await orderItem.save();

    // IT WILL RECALCULATE THE STATUSES FOR OVERLAPPING ITEMS OF THE SAME INVENTORY IN OTHER ORDERS.
    let relatedItems = await OrderItem.find({
      oi_inventory_fk_inventory_id: orderItem.oi_inventory_fk_inventory_id,
      oi_order_fk_order_id: { $ne: orderItem.oi_order_fk_order_id },
      oi_deleted: { $ne: true },
      $or: [
        {
          oi_pickup_at: {
            $lte: orderItem.oi_return_at,
            $gte: orderItem.oi_pickup_at,
          },
        },
        {
          oi_return_at: {
            $lte: orderItem.oi_return_at,
            $gte: orderItem.oi_pickup_at,
          },
        },
        {
          $and: [
            { oi_pickup_at: { $lte: orderItem.oi_pickup_at } },
            { oi_return_at: { $gte: orderItem.oi_return_at } },
          ],
        },
      ],
    });

    for (let item of relatedItems) {
      // IT WILL SKIP THE CONFIRMED ITEMS; THEY STAY AS-IS.
      if (item.oi_status === "confirmed") continue;
      let itemOrder = await Order.findOne({
        order_id: item.oi_order_fk_order_id,
      });
      if (!itemOrder) continue;

      // IT WILL GET THE STATUS AND UNAVAILABLE UNTIL.
      let { status, unavailableUntil } = await getStatus(
        itemOrder,
        item.oi_inventory_fk_inventory_id,
        item.oi_order_fk_order_id
      );

      item.oi_status = status;
      item.oi_unavailable_until = unavailableUntil;
      await item.save();
    }

    return res
      .status(200)
      .json({ message: "Order item removed and statuses recalculated" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createOrderItem,
  deleteOrderItem,
};
