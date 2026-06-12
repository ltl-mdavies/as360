export const apiConfig = {
  baseUrl:
    import.meta.env.VITE_API_BASE_URL ??
    (import.meta.env.DEV ? "" : "https://f08446049i.execute-api.us-east-1.amazonaws.com"),
};
