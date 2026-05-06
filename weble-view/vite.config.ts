import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/v1": {
        target: "https://api.weble.net",
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("origin", "https://www.revu.net");
            proxyReq.setHeader("referer", "https://www.revu.net/");
          });
        }
      },
      "/users": {
        target: "https://api.weble.net",
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            // Some endpoints validate Origin/Referer even with Bearer auth.
            proxyReq.setHeader("origin", "https://www.revu.net");
            proxyReq.setHeader("referer", "https://www.revu.net/");
          });
        }
      },
      "/campaigns": {
        target: "https://api.weble.net",
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("origin", "https://www.revu.net");
            proxyReq.setHeader("referer", "https://www.revu.net/");
          });
        }
      }
    }
  }
});

