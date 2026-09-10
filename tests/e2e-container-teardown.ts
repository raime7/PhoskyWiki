import { execFileSync } from 'node:child_process';

export default function teardown() {
  const name = process.env.PW_CONTAINER_NAME;
  if (process.env.TEST_APP_IMAGE && name && /^phosky-e2e-[a-f0-9]{12}$/.test(name)) {
    // Windows can terminate the launcher without delivering a Node signal.
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 30_000 });
  }
}
