const OrderItem = require("../schemas/orderItem.schema");

let dateRangesOverlap = (aStart, aEnd, bStart, bEnd) => {
  return aStart <= bEnd && bStart <= aEnd;
};

let resolveAvailabilityFromConflicts = (conflictingItems) => {
  if (conflictingItems.length === 0) {
    return { status: "available", unavailableUntil: undefined };
  }
  // IT WILL FIND THE CONFIRMED ITEM.
  let confirmed = conflictingItems.find((i) => i.oi_status === "confirmed");
  if (confirmed) {
    return {
      status: "unavailable-until",
      unavailableUntil: confirmed.oi_return_at,
    };
  }

  // IT WILL FIND THE STATUSES.
  let statuses = new Set(conflictingItems.map((i) => i.oi_status));
  if (
    statuses.has("on-hold") &&
    statuses.has("2nd-hold") &&
    statuses.has("3rd-hold")
  ) {
    return { status: "unavailable", unavailableUntil: undefined };
  }

  // IT WILL RETURN THE STATUS AND UNAVAILABLE UNTIL.
  return { status: "available", unavailableUntil: undefined };
};

let getHoldTierStatus = (conflictingItems) => {
  // IT WILL FIND THE HOLD STATUSES.
  let holdStatuses = conflictingItems.filter((item) =>
    ["on-hold", "2nd-hold", "3rd-hold"].includes(item.oi_status)
  );

  let holdRequestStatuses = conflictingItems.filter((item) =>
    ["on-hold-request", "2nd-hold-request", "3rd-hold-request"].includes(
      item.oi_status
    )
  );

  // Count existing holds (approved)
  let onHoldCount = holdStatuses.filter(
    (item) => item.oi_status === "on-hold"
  ).length;
  let secondHoldCount = holdStatuses.filter(
    (item) => item.oi_status === "2nd-hold"
  ).length;
  let thirdHoldCount = holdStatuses.filter(
    (item) => item.oi_status === "3rd-hold"
  ).length;

  // Count pending hold requests
  let onHoldRequestCount = holdRequestStatuses.filter(
    (item) => item.oi_status === "on-hold-request"
  ).length;
  let secondHoldRequestCount = holdRequestStatuses.filter(
    (item) => item.oi_status === "2nd-hold-request"
  ).length;
  let thirdHoldRequestCount = holdRequestStatuses.filter(
    (item) => item.oi_status === "3rd-hold-request"
  ).length;

  let totalHolds = onHoldCount + secondHoldCount + thirdHoldCount;
  let totalHoldRequests =
    onHoldRequestCount + secondHoldRequestCount + thirdHoldRequestCount;

  // Determine next hold tier
  if (totalHolds === 0 && totalHoldRequests === 0) {
    return "on-hold-request";
  } else if (totalHolds === 1 && totalHoldRequests === 0) {
    return "2nd-hold-request";
  } else if (totalHolds === 2 && totalHoldRequests === 0) {
    return "3rd-hold-request";
  } else if (totalHolds >= 3 || totalHoldRequests >= 3) {
    return "unavailable";
  } else {
    // Handle mixed scenarios
    let totalHoldActivity = totalHolds + totalHoldRequests;
    if (totalHoldActivity === 1) {
      return "2nd-hold-request";
    } else if (totalHoldActivity === 2) {
      return "3rd-hold-request";
    } else {
      return "unavailable";
    }
  }
};

let getStatus = async (order, inventoryId, currentOrderId) => {
  let pickupAt = order.order_pickup_at;
  let returnAt = order.order_return_at;

  let conflictingItems = await OrderItem.find({
    oi_inventory_fk_inventory_id: inventoryId,
    oi_order_fk_order_id: { $ne: currentOrderId },
    $or: [
      { oi_pickup_at: { $lte: returnAt, $gte: pickupAt } },
      { oi_return_at: { $lte: returnAt, $gte: pickupAt } },
      {
        $and: [
          { oi_pickup_at: { $lte: pickupAt } },
          { oi_return_at: { $gte: returnAt } },
        ],
      },
    ],
  });

  return resolveAvailabilityFromConflicts(conflictingItems);
};

module.exports = {
  getStatus,
  dateRangesOverlap,
  resolveAvailabilityFromConflicts,
  getHoldTierStatus,
};
