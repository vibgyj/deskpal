import { main } from './run.ts';

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`deskpal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
