# Standalone GenLayer games

This directory contains standalone GenLayer applications. Each application
owns its contracts, settlement rules, branding, tests, and deployment
configuration; applications must not depend on one another's state.

## Concurrent-work ownership

- `reality-bridge/` is owned by the Reality Bridge chat.
- `consensus-noir/` is owned by the Consensus Noir chat.

Each chat may read shared repository material for reference, but it must only
write inside its assigned application directory unless the user explicitly
authorizes a shared-root change. This prevents concurrent chats from modifying
the same package, lockfile, configuration, or generated artifact.
