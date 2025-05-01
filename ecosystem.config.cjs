// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "common_routes",
      script: "dist/common_routes/app.js",

      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        PORT: 3000,
        NODE_ENV: "development",
      },
    },
    {
      name: "scraper",
      script: "dist/scraper/app.js",

      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        PORT: 3001,
        NODE_ENV: "development",
      },
    },
    {
      name: "shifts",
      script: "dist/shifts/app.js",

      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        PORT: 3002,
        NODE_ENV: "development",
      },
    },
  ],
};
