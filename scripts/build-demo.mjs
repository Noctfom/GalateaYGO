import { spawnSync } from 'node:child_process';
const validation=spawnSync(process.execPath,['scripts/validate-registry.mjs'],{stdio:'inherit'});
if(validation.status!==0)process.exit(validation.status??1);
const result = spawnSync(process.execPath, ['node_modules/astro/astro.js', 'build'], {
  stdio: 'inherit', env: { ...process.env, PUBLIC_DEMO_MODE: 'true' },
});
if(result.status!==0)process.exit(result.status??1);
process.exit(spawnSync(process.execPath,['scripts/check-build.mjs','--demo'],{stdio:'inherit'}).status??1);
