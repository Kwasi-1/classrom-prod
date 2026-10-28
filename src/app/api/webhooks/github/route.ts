import { NextResponse, type NextRequest } from "next/server";
import { db, t } from "@/db";
import { githubApp } from "@/lib/github";
import { enqueue } from "@/lib/queue";
import { handleWebhook } from "@/lib/webhooks";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const deliveryId = req.headers.get("x-github-delivery");
  const event = req.headers.get("x-github-event");

  if (!signature || !deliveryId || !event) {
    return NextResponse.json({ error: "missing headers" }, { status: 400 });
  }
  let valid = false;
  try {
    valid = await githubApp().webhooks.verify(body, signature);
  } catch {
    valid = false;
  }
  if (!valid) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  // Idempotency: GitHub may redeliver; the first insert wins.
  const inserted = await db
    .insert(t.webhookDeliveries)
    .values({ deliveryId, event })
    .onConflictDoNothing()
    .returning({ id: t.webhookDeliveries.deliveryId });
  if (inserted.length === 0) return NextResponse.json({ ok: true, duplicate: true });

  const payload = JSON.parse(body) as unknown;
  enqueue(`${event}:${deliveryId}`, () => handleWebhook(event, payload));
  return NextResponse.json({ ok: true });
}
