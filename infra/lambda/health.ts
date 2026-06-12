export async function handler() {
  return json(200, {
    ok: true,
    service: process.env.SERVICE_NAME || "adspace360-api",
    time: new Date().toISOString(),
  });
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

