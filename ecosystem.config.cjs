module.exports = {
  apps: [
    // ─────────────────────────────────────────────────────────────────────────
    // Your existing apps (unchanged)
    // ─────────────────────────────────────────────────────────────────────────
    {
      name: "common_routes",
      script: "dist/app/common_routes/app.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",
      time: true,                      // timestamps
      merge_logs: true,                // single stream per app
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      out_file: 'logs/common_routes.log',
      instances: 1,
      exec_mode: "fork",
      watch: false,
    },
    {
      name: "scraper",
      script: "dist/app/scraper/app.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",
      time: true,                      // timestamps
      merge_logs: true,                // single stream per app
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      out_file: 'logs/scraper_routes.log',
      error_file: 'logs/scraper_routes.log',  // Add this to capture errors in same file
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
      name: "demucs_worker",
      script: "dist/app/common_routes/workers/demucs.worker.js",
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",
      instances: 1,
      exec_mode: "fork",
      watch: false,
    },


   
    
    {
      name: "redis-gui",
      cwd: "/home/ubuntu/Projects/oracle24hrs",   // make paths predictable
      script: "scripts/run-redis-gui.cjs",        // <- use the .cjs wrapper
      interpreter: "node",
      node_args: "-r ./doppler-production.cjs",   // okay to keep; wrapper ignores env
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: { NODE_ENV: "production" },
    }
    
    
  ],
};




