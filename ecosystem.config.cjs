// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "common_routes",
      script: "dist/common_routes/app.js",

      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
    {
      name: "scraper",
      script: "dist/scraper/app.js",

      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
    {
      name: "shifts",
      script: "dist/shifts/app.js",

      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
  ],
};
