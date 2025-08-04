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
    {
      name: "demucs_worker", // [ADD] Dedicated worker process
      script: "dist/app/common_routes/workers/demucs.worker.js", // [ADD] Run compiled worker file
      interpreter: "node", // [ADD] Same Node runtime
      node_args: "-r ./doppler-production.cjs", // [ADD] Load Doppler env (Upstash URL, etc.)
      instances: 1, // [ADD] One worker per host (CPU bound)
      exec_mode: "fork", // [ADD] Simple single instance
      watch: false, // [ADD] No watch in production
    },
  ],
};
