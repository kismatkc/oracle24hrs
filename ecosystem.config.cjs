const environments = () => ({
  PORT_common: "3000",
  PORT_scraper: "3001",
  PORT_shifts: "3002",

  OPENWEATHER_API: "4125f84eba0a2f3416c50a4695577fcc",

  APPWRITE_URL_STORAGE: "https://fra.cloud.appwrite.io/v1",
  APPWRITE_PROJECTID_music: "680176d3001131c8a4e7",
  APPWRITE_API_KEY:
    "standard_17844b2057d31a53694f426cdeaa3bd048df2a8e9f16f1d0a20ac41aeb231baf1198843cc4538a53296b2af451a12a0bdc78ccb6c78872e1a34265dfa8d44ce3d1b6569375d277c8b0adc81a4de3feedc81492bf6824e49ba82a9c0ab10fd36ac5ac4a8aef525ed125bc8fb21a9aec28b4b86031e8ce7d92c094792bef22958a",
  APPWRITE_MUSIC_BUCKETNAME: "6801777c0003a97d6c14",
});

// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "common_routes",
      script: "dist/app/common_routes/app.js",

      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: environments(),
    },
    {
      name: "scraper",
      script: "dist/app/scraper/app.js",

      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: environments(),
    },
    {
      name: "shifts",
      script: "dist/app/shifts/app.js",

      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: environments(),
    },
  ],
};
