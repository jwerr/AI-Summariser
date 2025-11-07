// frontend/src/setupProxy.js
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  const target = "http://127.0.0.1:8000"; // FastAPI dev server

  // If your FastAPI routes are mounted under /api (recommended):
  app.use(
    "/api",
    createProxyMiddleware({
      target,
      changeOrigin: true,
      // no pathRewrite needed if backend paths already start with /api
    })
  );

  // Health check passthrough (optional)
  app.use(
    "/ping",
    createProxyMiddleware({
      target,
      changeOrigin: true,
    })
  );
};
