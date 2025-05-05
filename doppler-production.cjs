const { execSync } = require("child_process");

const secrets = JSON.parse(
  execSync(
    "doppler --project orcale-24hrs --config prd secrets download --no-file --format=json",
    {
      encoding: "utf8",
    }
  )
);

// Set secrets as environment variables
Object.entries(secrets).forEach(([key, value]) => {
  process.env[key] = value;
});
