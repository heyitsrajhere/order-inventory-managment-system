const Order = require("../schemas/order.schema");
const OrderItem = require("../schemas/orderItem.schema");
const { getStatus, getHoldTierStatus } = require("../helper/orderItem");

let createOrder = async (req, res) => {
  try {
    // IT WILL SAVE THE ORDER IN ORDER COLLECTION.
    let order = new Order(req.body);
    await order.save();
    res.status(201).send(order);
  } catch (error) {
    res.status(400).send(error);
  }
};

let requestHold = async (req, res) => {
  try {
    let { order_id } = req.params;
    let { order_request_hold } = req.body;
    // IT WILL CHECK IF THE ORDER REQUEST HOLD IS A BOOLEAN VALUE.
    if (typeof order_request_hold !== "boolean") {
      return res
        .status(400)
        .json({ error: "order_request_hold must be a boolean value" });
    }
    // IT WILL FIND THE ORDER IN ORDER COLLECTION.
    let order = await Order.findOne({ order_id });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // IT WILL FIND THE ITEMS IN ORDER ITEM COLLECTION.
    let items = await OrderItem.find({
      oi_order_fk_order_id: order_id,
      oi_deleted: { $ne: true },
    });

    if (items.length === 0) {
      return res
        .status(400)
        .json({ error: "No items in order to request hold" });
    }

    if (order_request_hold) {
      // Request hold for all items in the order
      let updatedItems = [];
      let errors = [];
      for (let item of items) {
        // Skip if already confirmed
        if (item.oi_status === "confirmed") {
          continue;
        }
        // Find conflicting items for this inventory
        let conflictingItems = await OrderItem.find({
          oi_inventory_fk_inventory_id: item.oi_inventory_fk_inventory_id,
          oi_order_fk_order_id: { $ne: order_id },
          oi_deleted: { $ne: true },
          $or: [
            {
              oi_pickup_at: {
                $lte: order.order_return_at,
                $gte: order.order_pickup_at,
              },
            },
            {
              oi_return_at: {
                $lte: order.order_return_at,
                $gte: order.order_pickup_at,
              },
            },
            {
              $and: [
                { oi_pickup_at: { $lte: order.order_pickup_at } },
                { oi_return_at: { $gte: order.order_return_at } },
              ],
            },
          ],
        });

        // IT WILL DETERMINE THE HOLD TIER STATUS.
        let holdStatus = getHoldTierStatus(conflictingItems);
        if (holdStatus === "unavailable") {
          errors.push({
            inventory_id: item.oi_inventory_fk_inventory_id,
            message: "Maximum hold limit reached for this inventory",
          });
          continue;
        }

        // Update item status
        item.oi_status = holdStatus;
        item.oi_request_hold = true;
        item.oi_request_hold_at = new Date();
        await item.save();

        updatedItems.push({
          oi_id: item.oi_id,
          inventory_id: item.oi_inventory_fk_inventory_id,
          status: holdStatus,
        });
      }

      // Update order
      order.order_request_hold = true;
      order.order_status = "hold";
      await order.save();

      return res.status(200).json({
        message: "Hold request processed",
        order_id: order_id,
        updated_items: updatedItems,
        errors: errors.length > 0 ? errors : undefined,
      });
    } else {
      // Cancel hold request
      for (let item of items) {
        if (
          ["on-hold-request", "2nd-hold-request", "3rd-hold-request"].includes(
            item.oi_status
          )
        ) {
          // Recalculate status without hold request
          let { status, unavailableUntil } = await getStatus(
            order,
            item.oi_inventory_fk_inventory_id,
            order_id
          );
          item.oi_status = status;
          item.oi_unavailable_until = unavailableUntil;
          item.oi_request_hold = false;
          item.oi_request_hold_at = null;
          await item.save();
        }
      }

      order.order_request_hold = false;
      order.order_status = "working";
      await order.save();
      return res.status(200).json({
        message: "Hold request cancelled",
        order_id: order_id,
      });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

let updateOrder = async (req, res) => {
  try {
    let { order_id } = req.params;
    let { order_pickup_at, order_return_at } = req.body;
    // IT WILL FIND THE ORDER IN ORDER COLLECTION.
    let order = await Order.findOne({ order_id });
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Validate date inputs
    if (!order_pickup_at || !order_return_at) {
      return res
        .status(400)
        .json({ error: "Both pickup and return dates are required" });
    }
    let newPickup = new Date(order_pickup_at);
    let newReturn = new Date(order_return_at);
    if (isNaN(newPickup) || isNaN(newReturn) || newPickup > newReturn) {
      return res.status(400).json({ error: "Invalid pickup/return dates" });
    }

    // Check conflicts against confirmed items in other orders for each inventory in this order
    let items = await OrderItem.find({
      oi_order_fk_order_id: order_id,
      oi_deleted: { $ne: true },
    });
    for (let item of items) {
      let conflictingConfirmed = await OrderItem.findOne({
        oi_inventory_fk_inventory_id: item.oi_inventory_fk_inventory_id,
        oi_order_fk_order_id: { $ne: order_id },
        oi_status: "confirmed",
        $or: [
          { oi_pickup_at: { $lte: newReturn, $gte: newPickup } },
          { oi_return_at: { $lte: newReturn, $gte: newPickup } },
          {
            $and: [
              { oi_pickup_at: { $lte: newPickup } },
              { oi_return_at: { $gte: newReturn } },
            ],
          },
        ],
      });

      if (conflictingConfirmed) {
        return res.status(409).json({
          error:
            "Order dates conflict with a confirmed order for one or more items",
          inventory_id: item.oi_inventory_fk_inventory_id,
        });
      }
    }

    // Update the order dates
    order.order_pickup_at = newPickup;
    order.order_return_at = newReturn;
    await order.save();

    // IT WILL UPDATE THE ITEMS IN ORDER ITEM COLLECTION.
    for (let item of items) {
      item.oi_pickup_at = newPickup;
      item.oi_return_at = newReturn;
      let { status, unavailableUntil } = await getStatus(
        order,
        item.oi_inventory_fk_inventory_id,
        order_id
      );
      // IT WILL NOT OVERRIDE THE CONFIRMED ITEMS.
      if (item.oi_status !== "confirmed") {
        item.oi_status = status;
      }
      item.oi_unavailable_until = unavailableUntil;
      await item.save();
    }

    // IT WILL CLEAR THE HOLD FLAG AFTER DATE CHANGE.
    await Order.updateOne({ order_id }, { order_request_hold: false });

    return res.status(200).json({ message: "Order updated", order });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

let confirmOrder = async (req, res) => {
  try {
    let { order_id } = req.params;
    let order = await Order.findOne({ order_id });
    if (!order) return res.status(404).json({ error: "Order not found" });

    // IT WILL FIND THE ITEMS IN ORDER ITEM COLLECTION.
    let items = await OrderItem.find({
      oi_order_fk_order_id: order_id,
      oi_deleted: { $ne: true },
    });
    if (items.length === 0) {
      return res.status(400).json({ error: "No items in order to confirm" });
    }

    // Validate no conflicts and availability
    for (let item of items) {
      let { status } = await getStatus(
        order,
        item.oi_inventory_fk_inventory_id,
        order_id
      );
      if (status === "unavailable" || status === "unavailable-until") {
        return res.status(409).json({
          error: "One or more items are not available to confirm",
          inventory_id: item.oi_inventory_fk_inventory_id,
        });
      }
    }

    // Mark all items confirmed and update others in conflict to unavailable-until/tiers
    for (let item of items) {
      item.oi_status = "confirmed";
      item.oi_unavailable_until = order.order_return_at;
      await item.save();

      // For other overlapping items of same inventory in other orders, mark unavailable-until
      await OrderItem.updateMany(
        {
          oi_inventory_fk_inventory_id: item.oi_inventory_fk_inventory_id,
          oi_order_fk_order_id: { $ne: order_id },
          oi_deleted: { $ne: true },
          $or: [
            {
              oi_pickup_at: {
                $lte: order.order_return_at,
                $gte: order.order_pickup_at,
              },
            },
            {
              oi_return_at: {
                $lte: order.order_return_at,
                $gte: order.order_pickup_at,
              },
            },
            {
              $and: [
                { oi_pickup_at: { $lte: order.order_pickup_at } },
                { oi_return_at: { $gte: order.order_return_at } },
              ],
            },
          ],
        },
        {
          $set: {
            oi_status: "unavailable-until",
            oi_unavailable_until: order.order_return_at,
          },
        }
      );
    }

    order.order_status = "confirm";
    order.order_request_hold = false;
    await order.save();

    return res.status(200).json({ message: "Order confirmed", order });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

let approveHoldRequest = async (req, res) => {
  try {
    let { oi_id } = req.params;
    let { approved } = req.body;
    // IT WILL CHECK IF THE APPROVED IS A BOOLEAN VALUE.
    if (typeof approved !== "boolean") {
      return res
        .status(400)
        .json({ error: "approved must be a boolean value" });
    }
    let orderItem = await OrderItem.findOne({ oi_id });
    if (!orderItem) {
      return res.status(404).json({ error: "Order item not found" });
    }

    if (orderItem.oi_deleted) {
      return res
        .status(400)
        .json({ error: "Cannot approve deleted order item" });
    }

    // Check if item is eligible for approval
    let eligibleStatuses = [
      "on-hold-request",
      "2nd-hold-request",
      "3rd-hold-request",
    ];
    if (!eligibleStatuses.includes(orderItem.oi_status)) {
      return res.status(400).json({
        error: "Only items with hold-request statuses can be approved",
        current_status: orderItem.oi_status,
        eligible_statuses: eligibleStatuses,
      });
    }

    if (approved) {
      // Approve the hold request
      let newStatus;
      switch (orderItem.oi_status) {
        case "on-hold-request":
          newStatus = "on-hold";
          break;
        case "2nd-hold-request":
          newStatus = "2nd-hold";
          break;
        case "3rd-hold-request":
          newStatus = "3rd-hold";
          break;
        default:
          return res.status(400).json({ error: "Invalid status for approval" });
      }

      orderItem.oi_status = newStatus;
      orderItem.oi_request_hold = false; // Clear request flag after approval
      await orderItem.save();

      return res.status(200).json({
        message: "Hold request approved",
        oi_id: oi_id,
        previous_status: orderItem.oi_status,
        new_status: newStatus,
      });
    } else {
      // Reject the hold request
      let order = await Order.findOne({
        order_id: orderItem.oi_order_fk_order_id,
      });
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Recalculate status without hold request
      let { status, unavailableUntil } = await getStatus(
        order,
        orderItem.oi_inventory_fk_inventory_id,
        orderItem.oi_order_fk_order_id
      );

      orderItem.oi_status = status;
      orderItem.oi_unavailable_until = unavailableUntil;
      orderItem.oi_request_hold = false;
      orderItem.oi_request_hold_at = null;
      await orderItem.save();

      return res.status(200).json({
        message: "Hold request rejected",
        oi_id: oi_id,
        previous_status: orderItem.oi_status,
        new_status: status,
      });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

let getHoldRequests = async (req, res) => {
  try {
    let { status, order_id } = req.query;
    // IT WILL CREATE THE QUERY FOR THE HOLD REQUESTS.
    let query = {
      oi_deleted: { $ne: true },
      oi_status: {
        $in: ["on-hold-request", "2nd-hold-request", "3rd-hold-request"],
      },
    };
    // IT WILL CHECK IF THE STATUS IS PROVIDED.
    if (status) {
      query.oi_status = status;
    }
    if (order_id) {
      query.oi_order_fk_order_id = order_id;
    }

    // IT WILL FIND THE HOLD REQUESTS IN ORDER ITEM COLLECTION.
    let holdRequests = await OrderItem.find(query)
      .populate(
        "oi_order",
        "order_id order_name order_pickup_at order_return_at order_status"
      )
      .populate(
        "oi_inventory",
        "inventory_id inventory_barcode inventory_general"
      )
      .sort({ oi_request_hold_at: 1 }); // IT WILL SORT THE HOLD REQUESTS BY REQUEST TIME (FIRST-COME, FIRST-SERVED).

    return res.status(200).json({
      message: "Hold requests retrieved",
      count: holdRequests.length,
      hold_requests: holdRequests,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createOrder,
  updateOrder,
  requestHold,
  confirmOrder,
  approveHoldRequest,
  getHoldRequests,
};
