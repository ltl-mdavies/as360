// src/logic/lift/parseFlushOrder.ts
export type LiftOrderLine = {
  lineNumber: number;
  orderLineId?: number | null;
  qty: number;
  productName?: string | null;
  unitNumber?: string | null; // often null in your flush example
  artUrl?: string | null;     // if Lift provides it later
};

export function parseFlushOrderToLiftLines(flush: any): LiftOrderLine[] {
  const order = flush?.rowset?.[0];
  const lines = order?.LINES || [];

  return (lines as any[])
    .map((l) => ({
      lineNumber: Number(l.LINE_NUMBER),
      orderLineId: l.ORDER_LINE_ID ?? null,
      qty: Number(l.QUANTITY ?? 0),
      productName: l.PRODUCT_NAME ?? null,
      unitNumber: l.UNIT_NUMBER ?? null,
      artUrl: null,
    }))
    .filter((l) => Number.isFinite(l.lineNumber))
    .sort((a, b) => a.lineNumber - b.lineNumber);
}