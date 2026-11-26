import express from "express";
import request from "supertest";

// A throwaway app for a test: its route is not part of the shop.
const app = express();
app.get("/only-in-test", (_req, res) => res.send("x"));

export async function smoke() {
  await request(app).get("/only-in-test");
}
