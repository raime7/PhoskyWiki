const results = [];
for (let attempt = 1; attempt <= 4; attempt++) {
  const response = await fetch("http://localhost:3130/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3130" },
    body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(5000),
  });
  results.push({ attempt, status: response.status, retryAfter: response.headers.get("retry-after") });
  await response.arrayBuffer();
}
console.log(JSON.stringify(results, null, 2));
