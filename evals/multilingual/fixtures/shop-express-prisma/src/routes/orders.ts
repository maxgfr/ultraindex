import { Router } from "express";
import { cancelOrder, listOrders, placeOrder } from "../services/orders.js";

export const ordersRouter = Router();

ordersRouter.get("/orders", async (req, res) => {
  res.json(await listOrders(Number(req.query.userId)));
});

ordersRouter.post("/orders", async (req, res) => {
  res.status(201).json(await placeOrder(req.body));
});

ordersRouter
  .route("/orders/:id")
  .get(async (req, res) => {
    res.json({ id: req.params.id });
  })
  .delete(async (req, res) => {
    res.json(await cancelOrder(Number(req.params.id)));
  });

// ordersRouter.put("/orders/:id", updateOrder);  <- not shipped yet
/*
ordersRouter.patch("/orders/:id/status", setStatus);
*/
