type ApiEvent = {
  requestContext?: {
    http?: {
      method?: string;
    };
  };
};

export async function handler(event: ApiEvent) {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      websocketUrl: process.env.PRESENCE_WS_URL || "",
    }),
  };
}

function corsHeaders() {
  return {
    "access-control-allow-origin": process.env.APP_ORIGIN || "https://app.adspace360.com",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-share-token,x-share-participant-id",
    "content-type": "application/json",
  };
}
