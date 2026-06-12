export const authConfig = {
  region: import.meta.env.VITE_COGNITO_REGION || "us-east-1",
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || "us-east-1_31uNf5WFv",
  userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID || "140km9l9t6vdavqg16skl4j51v",
};

export const authStorageKey = "adspace360.auth.session";
