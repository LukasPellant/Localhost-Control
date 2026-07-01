export const parseArgs = (argv = process.argv.slice(2)) => {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args.set(arg, "true");
      continue;
    }

    const body = arg.slice(2);
    const separator = body.indexOf("=");
    if (separator !== -1) {
      args.set(body.slice(0, separator), body.slice(separator + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(body, next);
      index += 1;
      continue;
    }

    args.set(body, "true");
  }

  return args;
};
