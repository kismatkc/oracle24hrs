// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "common_routes",
      script: "dist/app/common_routes/app.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",

      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
    {
      name: "scraper",
      script: "dist/app/scraper/app.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",

      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
    {
      name: "shifts",
      script: "dist/app/shifts/app.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",

      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
  ],
};
