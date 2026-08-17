#!/usr/bin/env node
// The `prisma` bin. The implementation is @prisma/cli's, bundled in at
// build time (see tsdown.config.ts): the two published names ship the
// same shell, so a command cannot behave differently depending on which
// one a user installed.
import "@prisma/cli/src/bin";
