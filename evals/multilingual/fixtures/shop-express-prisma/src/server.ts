import express from "express";
import { ordersRouter } from "./routes/orders.js";

const app = express();

app.use(express.json());
app.use("/api", ordersRouter);

app.get("/health", (_req, res) => {
  res.send("ok");
});

const port = Number(process.env.PORT ?? 3000);
if (app.get("env") !== "test") {
  app.listen(port, () => console.log(`listening on ${port}; try app.get('/fake-from-log')`));
}

export default app;
