// src/logic/submitOrder.ts
import type { CreateOrderPayload } from "./orderBuilder";

export type SubmitOrderResult = {
  ok: boolean;
  liftOrderNumber?: string;
  error?: string;
};

export async function submitOrderToLiftStub(payload: CreateOrderPayload): Promise<SubmitOrderResult> {
  // Phase 3B.2: stub implementation.
  // Later: call Lift API, then return the real Lift order #.
  console.log("SUBMIT ORDER (stub) payload:", payload);

  // Simulate network
  await new Promise((r) => setTimeout(r, 350));

  return { ok: true, liftOrderNumber: "A0XXXXXX" };
}