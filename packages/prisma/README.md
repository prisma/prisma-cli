<p align="center">
  <img src="https://i.imgur.com/h6UIYTu.png" alt="Prisma" width="360" />
</p>

# Prisma CLI

[![npm version](https://img.shields.io/npm/v/prisma/next?label=npm%40next)](https://www.npmjs.com/package/prisma)
[![license](https://img.shields.io/npm/l/prisma)](https://github.com/prisma/prisma-cli/blob/main/LICENSE)

This is the Prisma 8 release candidate of the `prisma` package: the command-line interface for the Prisma Developer Platform. It is published under the `next` dist-tag while the release candidate matures; the `latest` dist-tag continues to serve the current stable Prisma CLI.

The package installs the `prisma` binary and delegates to [`@prisma/cli`](https://www.npmjs.com/package/@prisma/cli), which contains the CLI implementation.

## Quickstart

```bash
npm install --save-dev prisma@next
npx prisma --help
npx prisma auth login
npx prisma app deploy
```

## Documentation

- [CLI docs index](https://github.com/prisma/prisma-cli/blob/main/docs/README.md)
- [Command spec](https://github.com/prisma/prisma-cli/blob/main/docs/product/command-spec.md)

## Support

Please use [GitHub issues](https://github.com/prisma/prisma-cli/issues) for bug reports and feature requests.

Security reports should follow Prisma's [security policy](https://github.com/prisma/prisma-cli/blob/main/SECURITY.md) and should not be filed as public issues.

## License

Apache-2.0
