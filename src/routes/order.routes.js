const express = require("express");
const router = express.Router();
const orderController = require("../controllers/order.controller");

router.post("/", orderController.createOrder);
router.put("/request-hold/:order_id", orderController.requestHold);
router.put("/confirm-order/:order_id", orderController.confirmOrder);
router.put("/update-order/:order_id", orderController.updateOrder);

// Admin approval endpoints
router.get("/hold-requests", orderController.getHoldRequests);
router.put("/approve-hold/:oi_id", orderController.approveHoldRequest);

module.exports = router;
